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
    expect(graph.nodes).toHaveLength(21);
    expect(graph.nodes.filter((n) => n.ghost)).toHaveLength(3);
    expect(graph.links.filter((l) => l.kind === "link")).toHaveLength(47);
    expect(graph.links.filter((l) => l.kind === "tag")).toHaveLength(37);
  });

  it("copies every non-ghost node's file under PUBLIC_DIR/wiki/", () => {
    for (const node of graph.nodes) {
      if (node.ghost) continue;
      expect(fs.existsSync(path.join(outDir, "wiki", node.file))).toBe(true);
    }
  });

  it("gives a root-level page its own filename stem as type, not a shared 'root' bucket", () => {
    const glossary = graph.nodes.find((n) => n.id === "glossary");
    expect(glossary).toBeDefined();
    expect(glossary.type).toBe("glossary");
    const index = graph.nodes.find((n) => n.id === "index");
    expect(index).toBeDefined();
    expect(index.type).toBe("index");
    expect(index.type).not.toBe(glossary.type);
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

  it("gives each root-level file its own filename stem as type, including unicode slugs", () => {
    const byId = (id) => graph.nodes.find((n) => n.id === id);
    expect(byId("hello").type).toBe("hello");
    expect(byId("hub").type).toBe("hub");
    expect(byId("orphan").type).toBe("orphan");
    expect(byId("café").type).toBe("café");
    expect(byId("日本語ページ").type).toBe("日本語ページ");
    const rootTypes = new Set(["hello", "hub", "orphan", "café", "日本語ページ"].map((id) => byId(id).type));
    expect(rootTypes.size).toBe(5); // none collapsed into a shared bucket
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

  it("copies an image embedded via a relative ![]() reference, resolved next to its source page (M3)", () => {
    expect(fs.existsSync(path.join(outDir, "wiki", "assets", "diagram.svg"))).toBe(true);
  });

  it("copies the same image once even when referenced from a deeply-nested page via '..' (M3)", () => {
    // hello.md references assets/diagram.svg directly; buried.md references the same file via
    // ../../../assets/diagram.svg — both must resolve to the one copy at wiki/assets/diagram.svg.
    const copied = fs.readFileSync(path.join(outDir, "wiki", "assets", "diagram.svg"), "utf8");
    const source = fs.readFileSync(
      path.join(ROOT, "examples", "edge-case-wiki", "assets", "diagram.svg"),
      "utf8"
    );
    expect(copied).toBe(source);
  });
});

describe("parse-wiki.mjs against examples/config-wiki (.wikilink-graph.json, M9)", () => {
  it("applies exclude/hiddenTypes/hiddenTags from the config file when no env var overrides it", () => {
    const { graph } = runParser("examples/config-wiki");

    const archiveHub = graph.nodes.find((n) => n.id === "archive-hub");
    expect(archiveHub.excluded).toBe(true);

    expect(graph.meta.defaultHiddenTypes).toEqual(["notes"]);
    expect(graph.meta.defaultHiddenNodes).toEqual(["draft-page"]);
  });

  it("lets an explicit WIKI_EXCLUDE env var override the config file's exclude list (CLI/env > config precedence)", () => {
    const { graph } = runParser("examples/config-wiki", "");

    const archiveHub = graph.nodes.find((n) => n.id === "archive-hub");
    expect(archiveHub.excluded).toBe(false);
    // hiddenTypes/hiddenTags have no CLI/env equivalent (decision #18) — the config still applies.
    expect(graph.meta.defaultHiddenTypes).toEqual(["notes"]);
  });
});

describe("parse-wiki.mjs against a malformed .wikilink-graph.json (M9)", () => {
  it("warns and falls back to the built-in default instead of crashing", () => {
    const { graph } = runParser("examples/config-wiki-bad-config");

    expect(graph.nodes.find((n) => n.id === "hello")).toBeDefined();
    expect(graph.meta.defaultHiddenTypes).toEqual([]);
    expect(graph.meta.defaultHiddenNodes).toEqual([]);
  });
});
