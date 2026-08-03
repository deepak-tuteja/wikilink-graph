// @vitest-environment node
// Slow smoke test: actually spawns the CLI's "start" (real vite dev server) against
// examples/demo-wiki, polls until it serves, then "stop"s it and checks cleanup.
// Not run by the default `vitest run` — see the `test:cli` script and CI's dedicated step.
import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const CLI = path.join(ROOT, "bin", "wikilink-graph.mjs");
const PID_FILE = path.join(ROOT, ".wikilink-graph.pid");
const PORT = 5199;

function stopIfRunning() {
  try {
    execFileSync("node", [CLI, "stop"], { cwd: ROOT, stdio: "pipe" });
  } catch {
    // ignore — nothing running
  }
}

async function waitFor200(url, { retries = 30, delayMs = 500 } = {}) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return res;
    } catch {
      // server not up yet
    }
    await new Promise((r) => setTimeout(r, delayMs));
  }
  throw new Error(`${url} did not return 200 after ${retries} retries`);
}

describe("wikilink-graph CLI", () => {
  afterEach(() => {
    stopIfRunning();
  });

  it("start requires --wiki and exits non-zero with usage", () => {
    expect(() => execFileSync("node", [CLI, "start"], { cwd: ROOT, stdio: "pipe" })).toThrow();
    try {
      execFileSync("node", [CLI, "start"], { cwd: ROOT, stdio: "pipe" });
    } catch (e) {
      expect(e.status).not.toBe(0);
      expect(String(e.stderr) + String(e.stdout)).toMatch(/--wiki.*required|Usage/i);
    }
  });

  it("starts, serves the HTML shell, then stops cleanly", async () => {
    execFileSync("node", [CLI, "start", "--wiki", "examples/demo-wiki", "--port", String(PORT)], {
      cwd: ROOT,
      stdio: "pipe",
    });

    const res = await waitFor200(`http://localhost:${PORT}`);
    const html = await res.text();
    expect(html).toContain("<div id=\"root\">");

    execFileSync("node", [CLI, "stop"], { cwd: ROOT, stdio: "pipe" });
    expect(fs.existsSync(PID_FILE)).toBe(false);

    await expect(fetch(`http://localhost:${PORT}`)).rejects.toThrow();
  }, 60_000);

  it("refuses to start twice without stop in between", () => {
    execFileSync("node", [CLI, "start", "--wiki", "examples/demo-wiki", "--port", String(PORT)], {
      cwd: ROOT,
      stdio: "pipe",
    });
    expect(() =>
      execFileSync("node", [CLI, "start", "--wiki", "examples/demo-wiki", "--port", String(PORT)], {
        cwd: ROOT,
        stdio: "pipe",
      }),
    ).toThrow(/already running/);
  }, 30_000);
});
