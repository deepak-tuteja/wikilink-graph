#!/usr/bin/env node
// wikilink-graph CLI — easily start / stop the graph viewer against any wiki.
//
//   wikilink-graph start --wiki <path> [--port 5179] [--exclude INDEX,synthesis] [--build]
//   wikilink-graph stop
//   wikilink-graph status
//
// --wiki (the folder of [[slug]]-linked .md files) is MANDATORY on start: pointing the
// viewer at a wiki is the whole point. The command runs the parser against that folder,
// then serves Vite in the background, tracking the process so `stop` can cleanly kill it.

import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync, execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, ".."); // bin/ -> project root
const PID_FILE = path.join(ROOT, ".wikilink-graph.pid");
const LOG_FILE = path.join(ROOT, ".wikilink-graph.log");
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

const USAGE = `${color("bold", "wikilink-graph")} — Obsidian-style viewer for a [[slug]]-linked markdown wiki

${color("bold", "Usage:")}
  wikilink-graph start --wiki <path> [options]   start the viewer (parses the wiki, serves it)
  wikilink-graph stop                            stop the running viewer
  wikilink-graph status                          show whether it's running

${color("bold", "Start options:")}
  -w, --wiki <path>      ${color("red", "(required)")} folder of the wiki's .md files
  -p, --port <n>         serve port (default ${DEFAULT_PORT})
  -e, --exclude <slugs>  comma-list of page slugs hidden by default (default ${DEFAULT_EXCLUDE})
      --build            build a self-contained dist/ and serve that, instead of the live dev server
      --watch            dev mode only: re-parse + reload whenever a .md file under --wiki changes

${color("bold", "Examples:")}
  wikilink-graph start --wiki examples/demo-wiki
  wikilink-graph start -w ~/notes/wiki -p 5200 --build
  wikilink-graph start -w ~/notes/wiki --watch
  wikilink-graph stop`;

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
      case "-h": case "--help": out.help = true; break;
      default:
        if (a.startsWith("-")) die(`unknown option ${a}`);
        out._.push(a);
    }
  }
  return out;
}

// ---- process tracking ------------------------------------------------------
function readPid() {
  try {
    const data = JSON.parse(fs.readFileSync(PID_FILE, "utf8"));
    return data && typeof data.pid === "number" ? data : null;
  } catch {
    return null;
  }
}

function isAlive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function clearPid() {
  try { fs.unlinkSync(PID_FILE); } catch {}
}

function runningState() {
  const rec = readPid();
  if (rec && isAlive(rec.pid)) return rec;
  if (rec) clearPid(); // stale
  return null;
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

// ---- commands --------------------------------------------------------------
function cmdStart(args) {
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

  const existing = runningState();
  if (existing) {
    die(`already running (pid ${existing.pid}) on port ${existing.port}. Run "wikilink-graph stop" first.`);
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
  const viteArgs = args.build ? ["vite", "preview"] : ["vite"];
  const log = fs.openSync(LOG_FILE, "a");
  const child = spawn("npx", viteArgs, {
    cwd: ROOT,
    env,
    detached: true,
    stdio: ["ignore", log, log],
  });
  child.unref();

  fs.writeFileSync(
    PID_FILE,
    JSON.stringify({
      pid: child.pid, port, wikiDir, build: !!args.build, watch, startedAt: new Date().toISOString(),
    }),
  );

  const ip = lanIp();
  ok(`\nwikilink-graph is running (pid ${child.pid})`);
  info(`  local:  ${color("cyan", `http://localhost:${port}`)}`);
  if (ip) info(`  LAN:    ${color("cyan", `http://${ip}:${port}`)}`);
  info(`  wiki:   ${wikiDir}`);
  const mode = args.build ? "build + preview" : watch ? "dev (live, --watch)" : "dev (live)";
  info(color("dim", `  mode:   ${mode}   logs: ${LOG_FILE}`));
  info(color("dim", `  stop:   wikilink-graph stop`));
}

function cmdStop() {
  const rec = runningState();
  if (!rec) {
    // Best-effort fallback: free the default port in case of an untracked server.
    spawnSync("bash", ["-c", `fuser -k ${DEFAULT_PORT}/tcp 2>/dev/null || true`]);
    clearPid();
    warn("nothing tracked as running. Freed the default port just in case.");
    return;
  }
  try {
    process.kill(-rec.pid, "SIGTERM"); // kill the whole process group
  } catch {
    try { process.kill(rec.pid, "SIGTERM"); } catch {}
  }
  // Belt and suspenders: free the port the server was on.
  spawnSync("bash", ["-c", `fuser -k ${rec.port}/tcp 2>/dev/null || true`]);
  clearPid();
  ok(`stopped wikilink-graph (was pid ${rec.pid} on port ${rec.port}).`);
}

function cmdStatus() {
  const rec = runningState();
  if (!rec) {
    info("wikilink-graph is " + color("yellow", "not running") + ".");
    return;
  }
  const ip = lanIp();
  ok(`wikilink-graph is running (pid ${rec.pid}).`);
  info(`  local:  http://localhost:${rec.port}`);
  if (ip) info(`  LAN:    http://${ip}:${rec.port}`);
  info(`  wiki:   ${rec.wikiDir}`);
  const mode = rec.build ? "build + preview" : rec.watch ? "dev (live, --watch)" : "dev (live)";
  info(color("dim", `  mode:   ${mode}   since ${rec.startedAt}`));
}

// ---- dispatch --------------------------------------------------------------
const argv = process.argv.slice(2);
const cmd = argv[0];
const args = parseArgs(argv.slice(1));

switch (cmd) {
  case "start": cmdStart(args); break;
  case "stop": cmdStop(); break;
  case "status": cmdStatus(); break;
  case undefined:
  case "-h": case "--help": case "help": info(USAGE); break;
  default: die(`unknown command "${cmd}". Run "wikilink-graph --help".`);
}
