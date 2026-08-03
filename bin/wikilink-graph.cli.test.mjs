// @vitest-environment node
// Slow smoke test: actually spawns the CLI's "start" (real vite dev server) against
// examples/demo-wiki, polls until it serves, then "stop"s it and checks cleanup.
// Not run by the default `vitest run` — see the `test:cli` script and CI's dedicated step.
import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const CLI = path.join(ROOT, "bin", "wikilink-graph.mjs");
const STATE_DIR = path.join(ROOT, ".wikilink-graph");
const PORT = 5199;
const PORT2 = 5198;
const PORT3 = 5197;

function stateFile(port) {
  return path.join(STATE_DIR, `${port}.json`);
}

function stopIfRunning() {
  try {
    execFileSync("node", [CLI, "stop", "--all"], { cwd: ROOT, stdio: "pipe" });
  } catch {
    // ignore — nothing running
  }
}

function start(port, wiki = "examples/demo-wiki") {
  return execFileSync("node", [CLI, "start", "--wiki", wiki, "--port", String(port)], {
    cwd: ROOT,
    stdio: "pipe",
  });
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
    start(PORT);

    const res = await waitFor200(`http://localhost:${PORT}`);
    const html = await res.text();
    expect(html).toContain("<div id=\"root\">");

    execFileSync("node", [CLI, "stop", "--port", String(PORT)], { cwd: ROOT, stdio: "pipe" });
    expect(fs.existsSync(stateFile(PORT))).toBe(false);

    await expect(fetch(`http://localhost:${PORT}`)).rejects.toThrow();
  }, 60_000);

  it("refuses to start twice on the same port without stop in between", () => {
    start(PORT);
    expect(() => start(PORT)).toThrow(/already running/);
  }, 30_000);

  it("runs two instances concurrently on different ports; status lists both", async () => {
    start(PORT, "examples/demo-wiki");
    start(PORT2, "examples/edge-case-wiki");

    await waitFor200(`http://localhost:${PORT}`);
    await waitFor200(`http://localhost:${PORT2}`);

    const { stdout } = await execFileAsync("node", [CLI, "status"], { cwd: ROOT });
    expect(stdout).toContain("2 instances running");
    expect(stdout).toContain(String(PORT));
    expect(stdout).toContain(String(PORT2));
  }, 60_000);

  it("bare stop refuses (and lists) when 2+ instances are running", async () => {
    start(PORT);
    start(PORT2);
    await waitFor200(`http://localhost:${PORT}`);
    await waitFor200(`http://localhost:${PORT2}`);

    try {
      execFileSync("node", [CLI, "stop"], { cwd: ROOT, stdio: "pipe" });
      expect.unreachable("bare stop should have exited non-zero with 2+ running");
    } catch (e) {
      expect(e.status).not.toBe(0);
      const out = String(e.stdout) + String(e.stderr);
      expect(out).toMatch(/--port.*--all/);
      expect(out).toContain(String(PORT));
      expect(out).toContain(String(PORT2));
    }

    // both instances must still be alive — the refusal must not have killed anything
    expect(fs.existsSync(stateFile(PORT))).toBe(true);
    expect(fs.existsSync(stateFile(PORT2))).toBe(true);
  }, 60_000);

  it("stop --port stops only that instance, leaving the other running", async () => {
    start(PORT);
    start(PORT2);
    await waitFor200(`http://localhost:${PORT}`);
    await waitFor200(`http://localhost:${PORT2}`);

    execFileSync("node", [CLI, "stop", "--port", String(PORT)], { cwd: ROOT, stdio: "pipe" });

    expect(fs.existsSync(stateFile(PORT))).toBe(false);
    expect(fs.existsSync(stateFile(PORT2))).toBe(true);
    await expect(fetch(`http://localhost:${PORT}`)).rejects.toThrow();
    const res = await fetch(`http://localhost:${PORT2}`);
    expect(res.ok).toBe(true);
  }, 60_000);

  it("a port already held by something else fails start cleanly (strictPort) with no stray state", async () => {
    const holder = net.createServer();
    await new Promise((resolve, reject) => {
      holder.once("error", reject);
      holder.listen(PORT3, resolve);
    });

    try {
      expect(() => start(PORT3)).toThrow();
      expect(fs.existsSync(stateFile(PORT3))).toBe(false);
    } finally {
      await new Promise((resolve) => holder.close(resolve));
    }
  }, 30_000);
});
