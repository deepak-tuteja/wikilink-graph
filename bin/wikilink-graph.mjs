#!/usr/bin/env node
// wikilink-graph CLI — easily start / stop the graph viewer against any wiki.
//
//   wikilink-graph start --wiki <path> [--port 5179] [--exclude INDEX,synthesis] [--build]
//   wikilink-graph stop [--port <n>] [--all]
//   wikilink-graph status [--port <n>]
//
// --wiki (the folder of [[slug]]-linked .md files) is MANDATORY on start: pointing the
// viewer at a wiki is the whole point. The command runs the parser against that folder,
// then serves Vite in the background, tracking the process so `stop` can cleanly kill it.
//
// Multiple wikis can run at once, each on its own port — instances are tracked one file per
// port under .wikilink-graph/ (not a single shared pid file), so `status`/`stop` can target
// one or list/stop them all.

import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync, execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, ".."); // bin/ -> project root
const STATE_DIR = path.join(ROOT, ".wikilink-graph");
const DEFAULT_PORT = 5179;
const DEFAULT_EXCLUDE = "INDEX,synthesis";

const C = {
  reset: "\x1b[0m", bold: "\x1b[1m", dim: "\x1b[2m",
  red: "\x1b[31m", green: "\x1b[32m", yellow: "\x1b[33m", cyan: "\x1b[36m",
};
const color = (c, s) => `${C[c]}${s}${C.reset}`;
const info = (s) => console.log(s);
const ok = (s) => console.log(color("green", s));
const warn = (s) => console.log(color("yellow", s));
const die = (s) => { console.error(color("red", `error: ${s}`)); process.exit(1); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const USAGE = `${color("bold", "wikilink-graph")} — Obsidian-style viewer for a [[slug]]-linked markdown wiki

${color("bold", "Usage:")}
  wikilink-graph start --wiki <path> [options]   start the viewer (parses the wiki, serves it)
  wikilink-graph stop [--port <n>] [--all]       stop the running viewer(s)
  wikilink-graph status [--port <n>]             show what's running

Multiple wikis can run at once, each on its own port. With no --port, "stop"/"status" act on
the single running instance if there's exactly one, or list all of them if there are several.

${color("bold", "Start options:")}
  -w, --wiki <path>      ${color("red", "(required)")} folder of the wiki's .md files
  -p, --port <n>         serve port (default ${DEFAULT_PORT})
  -e, --exclude <slugs>  comma-list of page slugs hidden by default (default ${DEFAULT_EXCLUDE})
      --build            build a self-contained dist/ and serve that, instead of the live dev server
      --watch            dev mode only: re-parse + reload whenever a .md file under --wiki changes

${color("bold", "Stop options:")}
  -p, --port <n>         stop only the instance on this port
      --all              stop every running instance

${color("bold", "Examples:")}
  wikilink-graph start --wiki examples/demo-wiki
  wikilink-graph start -w ~/notes/wiki -p 5200 --build
  wikilink-graph start -w ~/other-wiki -p 5201
  wikilink-graph status
  wikilink-graph stop --port 5200
  wikilink-graph stop --all`;

// ---- arg parsing -----------------------------------------------------------
function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const take = () => {
      const v = argv[++i];
      if (v === undefined) die(`missing value for ${a}`);
      return v;
    };
    switch (a) {
      case "-w": case "--wiki": out.wiki = take(); break;
      case "-p": case "--port": out.port = take(); break;
      case "-e": case "--exclude": out.exclude = take(); break;
      case "--build": out.build = true; break;
      case "--watch": out.watch = true; break;
      case "--all": out.all = true; break;
      case "-h": case "--help": out.help = true; break;
      default:
        if (a.startsWith("-")) die(`unknown option ${a}`);
        out._.push(a);
    }
  }
  return out;
}

// ---- process tracking (one state file per port under STATE_DIR) -----------
function ensureStateDir() {
  fs.mkdirSync(STATE_DIR, { recursive: true });
}

function stateFile(port) {
  return path.join(STATE_DIR, `${port}.json`);
}

function logFile(port) {
  return path.join(STATE_DIR, `${port}.log`);
}

function isAlive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function clearState(port) {
  try { fs.unlinkSync(stateFile(port)); } catch {}
}

// Every tracked instance, alive-only — stale (dead-pid) entries are dropped as a side effect.
function listRunning() {
  let files;
  try { files = fs.readdirSync(STATE_DIR); } catch { return []; }
  const out = [];
  for (const f of files) {
    if (!f.endsWith(".json")) continue;
    let rec;
    try { rec = JSON.parse(fs.readFileSync(path.join(STATE_DIR, f), "utf8")); } catch { continue; }
    if (rec && typeof rec.pid === "number" && typeof rec.port === "number" && isAlive(rec.pid)) {
      out.push(rec);
    } else {
      try { fs.unlinkSync(path.join(STATE_DIR, f)); } catch {}
    }
  }
  return out.sort((a, b) => a.port - b.port);
}

function findRunning(port) {
  return listRunning().find((r) => r.port === port) ?? null;
}

function tailLines(file, n = 20) {
  try {
    const lines = fs.readFileSync(file, "utf8").split("\n").filter(Boolean);
    return lines.slice(-n).join("\n");
  } catch {
    return null;
  }
}

function lanIp() {
  try {
    return execSync("ip route get 1 2>/dev/null | awk '{print $7; exit}'", {
      encoding: "utf8",
    }).trim();
  } catch {
    return null;
  }
}

function killTree(rec) {
  try {
    process.kill(-rec.pid, "SIGTERM"); // kill the whole process group
  } catch {
    try { process.kill(rec.pid, "SIGTERM"); } catch {}
  }
  // Belt and suspenders: free the port the server was on.
  spawnSync("bash", ["-c", `fuser -k ${rec.port}/tcp 2>/dev/null || true`]);
  clearState(rec.port);
}

function describe(rec, ip) {
  info(`  local:  ${color("cyan", `http://localhost:${rec.port}`)}`);
  if (ip) info(`  LAN:    ${color("cyan", `http://${ip}:${rec.port}`)}`);
  info(`  wiki:   ${rec.wikiDir}`);
  const mode = rec.build ? "build + preview" : rec.watch ? "dev (live, --watch)" : "dev (live)";
  info(color("dim", `  mode:   ${mode}   since ${rec.startedAt}`));
}

// ---- commands --------------------------------------------------------------
async function cmdStart(args) {
  if (args.help || !args.wiki) {
    if (!args.wiki && !args.help) console.error(color("red", "error: --wiki <path> is required\n"));
    info(USAGE);
    process.exit(args.wiki ? 0 : 1);
  }

  const wikiDir = path.resolve(process.cwd(), args.wiki);
  if (!fs.existsSync(wikiDir) || !fs.statSync(wikiDir).isDirectory()) {
    die(`wiki path is not a directory: ${wikiDir}`);
  }
  const hasMd = fs.readdirSync(wikiDir).some((f) => f.endsWith(".md"));
  if (!hasMd) warn(`warning: no .md files directly in ${wikiDir} (the parser also recurses subfolders)`);

  const port = Number(args.port) || DEFAULT_PORT;
  const exclude = args.exclude ?? DEFAULT_EXCLUDE;
  const watch = !!args.watch && !args.build;
  if (args.watch && args.build) warn("warning: --watch is ignored with --build (dist/ stays a frozen snapshot)");

  const existing = findRunning(port);
  if (existing) {
    die(`already running (pid ${existing.pid}) on port ${port}. Run "wikilink-graph stop --port ${port}" first.`);
  }

  // Make sure deps are installed before we try to parse/serve.
  if (!fs.existsSync(path.join(ROOT, "node_modules"))) {
    info("installing dependencies (first run)…");
    const r = spawnSync("npm", ["install"], { cwd: ROOT, stdio: "inherit" });
    if (r.status !== 0) die("npm install failed");
  }

  const env = {
    ...process.env,
    WIKI_DIR: wikiDir,
    WIKI_EXCLUDE: exclude,
    PORT: String(port),
    ...(watch ? { WIKI_WATCH: "1" } : {}),
  };

  // 1) Parse the wiki synchronously so failures surface immediately and clearly.
  info(`parsing wiki: ${color("cyan", wikiDir)}`);
  const parse = spawnSync("node", ["scripts/parse-wiki.mjs"], { cwd: ROOT, env, stdio: "inherit" });
  if (parse.status !== 0) die("wiki parse failed");

  // 2) Optionally build a self-contained dist/.
  if (args.build) {
    info("building self-contained dist/…");
    const b = spawnSync("npx", ["vite", "build"], { cwd: ROOT, env, stdio: "inherit" });
    if (b.status !== 0) die("vite build failed");
  }

  // 3) Serve in the background, in its own process group so stop kills the whole tree.
  ensureStateDir();
  const viteArgs = args.build ? ["vite", "preview"] : ["vite"];
  const log = fs.openSync(logFile(port), "a");
  const child = spawn("npx", viteArgs, {
    cwd: ROOT,
    env,
    detached: true,
    stdio: ["ignore", log, log],
  });
  child.unref();

  // Vite is strictPort (see vite.config.ts): if the port's taken it exits immediately instead
  // of silently binding elsewhere. Give it a moment, then confirm it's actually still alive
  // before declaring success — otherwise we'd report "running" on a server that already died.
  await sleep(600);
  if (!isAlive(child.pid)) {
    const tail = tailLines(logFile(port));
    die(`vite failed to start on port ${port}.${tail ? `\n\n${color("dim", tail)}` : ""}`);
  }

  fs.writeFileSync(
    stateFile(port),
    JSON.stringify({
      pid: child.pid, port, wikiDir, build: !!args.build, watch, startedAt: new Date().toISOString(),
    }),
  );

  const ip = lanIp();
  ok(`\nwikilink-graph is running (pid ${child.pid})`);
  describe({ port, wikiDir, build: !!args.build, watch, startedAt: "now" }, ip);
  info(color("dim", `  logs:   ${logFile(port)}`));
  info(color("dim", `  stop:   wikilink-graph stop --port ${port}`));
}

function cmdStop(args) {
  const running = listRunning();

  if (args.all) {
    if (running.length === 0) { warn("nothing tracked as running."); return; }
    for (const rec of running) {
      killTree(rec);
      ok(`stopped wikilink-graph (was pid ${rec.pid} on port ${rec.port}).`);
    }
    return;
  }

  if (args.port) {
    const port = Number(args.port);
    const rec = running.find((r) => r.port === port);
    if (!rec) {
      // Best-effort fallback: free that port in case of an untracked/stale server.
      spawnSync("bash", ["-c", `fuser -k ${port}/tcp 2>/dev/null || true`]);
      clearState(port);
      warn(`nothing tracked as running on port ${port}. Freed it just in case.`);
      return;
    }
    killTree(rec);
    ok(`stopped wikilink-graph (was pid ${rec.pid} on port ${rec.port}).`);
    return;
  }

  if (running.length === 0) {
    // Best-effort fallback: free the default port in case of an untracked server.
    spawnSync("bash", ["-c", `fuser -k ${DEFAULT_PORT}/tcp 2>/dev/null || true`]);
    warn("nothing tracked as running. Freed the default port just in case.");
    return;
  }

  if (running.length > 1) {
    warn(`${running.length} instances are running — pass --port <n> or --all:`);
    for (const rec of running) info(`  port ${rec.port}   pid ${rec.pid}   wiki ${rec.wikiDir}`);
    process.exit(1);
  }

  killTree(running[0]);
  ok(`stopped wikilink-graph (was pid ${running[0].pid} on port ${running[0].port}).`);
}

function cmdStatus(args) {
  if (args.port) {
    const rec = findRunning(Number(args.port));
    if (!rec) { info(`wikilink-graph on port ${args.port} is ` + color("yellow", "not running") + "."); return; }
    ok(`wikilink-graph is running (pid ${rec.pid}).`);
    describe(rec, lanIp());
    return;
  }

  const running = listRunning();
  if (running.length === 0) {
    info("wikilink-graph is " + color("yellow", "not running") + ".");
    return;
  }
  const ip = lanIp();
  if (running.length === 1) {
    ok(`wikilink-graph is running (pid ${running[0].pid}).`);
    describe(running[0], ip);
    return;
  }
  ok(`${running.length} instances running:`);
  for (const rec of running) {
    info("");
    info(color("bold", `  port ${rec.port} (pid ${rec.pid})`));
    describe(rec, ip);
  }
}

// ---- dispatch --------------------------------------------------------------
const argv = process.argv.slice(2);
const cmd = argv[0];
const args = parseArgs(argv.slice(1));

switch (cmd) {
  case "start": await cmdStart(args); break;
  case "stop": cmdStop(args); break;
  case "status": cmdStatus(args); break;
  case undefined:
  case "-h": case "--help": case "help": info(USAGE); break;
  default: die(`unknown command "${cmd}". Run "wikilink-graph --help".`);
}
