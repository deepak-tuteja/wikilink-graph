// @vitest-environment node
// Runs the real parser as a child process against the committed example fixtures,
// writing into a scratch PUBLIC_DIR so it never touches the repo's own public/.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PARSER = path.join(ROOT, "scripts", "parse-wiki.mjs");

const scratchDirs = [];

function runParser(wikiDir, exclude) {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "wikilink-graph-test-"));
  scratchDirs.push(outDir);
  execFileSync("node", [PARSER], {
    cwd: ROOT,
    env: {
      ...process.env,
      WIKI_DIR: wikiDir,
      PUBLIC_DIR: outDir,
      ...(exclude !== undefined ? { WIKI_EXCLUDE: exclude } : {}),
    },
    stdio: "pipe",
  });
  const graph = JSON.parse(fs.readFileSync(path.join(outDir, "graph.json"), "utf8"));
  return { outDir, graph };
}

afterAll(() => {
  for (const dir of scratchDirs) fs.rmSync(dir, { recursive: true, force: true });
});

describe("parse-wiki.mjs against examples/demo-wiki", () => {
  let graph, outDir;
  beforeEach(() => {
    ({ graph, outDir } = runParser("examples/demo-wiki"));
  });

  it("matches the known-good node/edge counts", () => {
    expect(graph.nodes).toHaveLength(20);
    expect(graph.nodes.filter((n) => n.ghost)).toHaveLength(3);
    expect(graph.links.filter((l) => l.kind === "link")).toHaveLength(44);
    expect(graph.links.filter((l) => l.kind === "tag")).toHaveLength(37);
  });

  it("copies every non-ghost node's file under PUBLIC_DIR/wiki/", () => {
    for (const node of graph.nodes) {
      if (node.ghost) continue;
      expect(fs.existsSync(path.join(outDir, "wiki", node.file))).toBe(true);
    }
  });
});

describe("parse-wiki.mjs against examples/edge-case-wiki", () => {
  let graph, outDir;
  beforeEach(() => {
    ({ graph, outDir } = runParser("examples/edge-case-wiki"));
  });

  it("matches the known-good node/edge counts and runs without crashing", () => {
    expect(graph.nodes).toHaveLength(31);
    expect(graph.nodes.filter((n) => n.ghost)).toHaveLength(25);
    expect(graph.links.filter((l) => l.kind === "link")).toHaveLength(31);
  });

  it("round-trips unicode slugs", () => {
    const ids = graph.nodes.map((n) => n.id);
    expect(ids).toContain("café");
    expect(ids).toContain("日本語ページ");
  });

  it("resolves the type of a deeply nested file to its top-level folder", () => {
    const buried = graph.nodes.find((n) => n.id === "buried");
    expect(buried).toBeDefined();
    expect(buried.type).toBe("deep");
  });

  it("turns every dangling link into a ghost node with no crash", () => {
    const ghosts = graph.nodes.filter((n) => n.ghost);
    expect(ghosts.length).toBeGreaterThan(20);
    for (const g of ghosts) {
      expect(g.type).toBe("ghost");
      expect(g.file).toBeNull();
    }
  });

  it("copies every non-ghost node's file under PUBLIC_DIR/wiki/", () => {
    for (const node of graph.nodes) {
      if (node.ghost) continue;
      expect(fs.existsSync(path.join(outDir, "wiki", node.file))).toBe(true);
    }
  });
});
