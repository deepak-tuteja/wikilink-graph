// Vite plugin: when WIKI_WATCH=1, re-runs scripts/parse-wiki.mjs whenever a .md file under
// WIKI_DIR changes, then tells the client to do a full reload. Hooks into Vite's own built-in
// chokidar watcher (server.watcher) instead of pulling in a new file-watching dependency.
// Dev-mode only (see bin/wikilink-graph.mjs's --watch flag); --build/preview stays a frozen
// snapshot. See PLAN.md decisions #15-17.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
// Kept in sync with parse-wiki.mjs's own default (examples/synthetic-wiki).
const WIKI_DIR = path.resolve(ROOT, process.env.WIKI_DIR || "examples/synthetic-wiki");
const DEBOUNCE_MS = 300;

// wikiDir defaults to the module-level WIKI_DIR (resolved from process.env at import time); the
// param exists so this pure check can be unit-tested independent of the environment.
export function isInsideWikiDir(file, wikiDir = WIKI_DIR) {
  const rel = path.relative(wikiDir, file);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

export function watchWikiPlugin() {
  let timer = null;

  function scheduleReparse(server) {
    clearTimeout(timer);
    timer = setTimeout(() => {
      server.config.logger.info("[wikilink-graph] wiki changed, re-parsing…", { timestamp: true });
      const r = spawnSync("node", ["scripts/parse-wiki.mjs"], {
        cwd: ROOT,
        env: process.env,
        stdio: "inherit",
      });
      if (r.status !== 0) {
        server.config.logger.error(
          "[wikilink-graph] re-parse failed, keeping the previous graph.json",
          { timestamp: true }
        );
        return;
      }
      server.ws.send({ type: "full-reload" });
    }, DEBOUNCE_MS);
  }

  return {
    name: "wikilink-graph-watch-wiki",
    configureServer(server) {
      server.watcher.add(WIKI_DIR);
      const onChange = (file) => {
        if (!file.endsWith(".md") || !isInsideWikiDir(file)) return;
        scheduleReparse(server);
      };
      server.watcher.on("add", onChange);
      server.watcher.on("change", onChange);
      server.watcher.on("unlink", onChange);
    },
  };
}
