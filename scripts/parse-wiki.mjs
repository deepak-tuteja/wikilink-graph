#!/usr/bin/env node
// Build-time parser: walk WIKI_DIR, extract a node/edge graph from [[slug]] and
// relative [](file.md) links, copy the .md files for static serving, and emit
// public/graph.json. See ../PLAN.md. Pure extraction logic lives in lib/parse-core.mjs
// (no fs/process.env access, unit tested — see ../PLAN_TESTING.md Phase 1); this file
// owns env/fs and orchestration only.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  slugify,
  titleFromSlug,
  topLevelType,
  frontmatterLines,
  frontmatterTags,
  pageStatus,
  extractWikilinks,
  extractMdLinks,
  EdgeSet,
} from "./lib/parse-core.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const WIKI_DIR = path.resolve(ROOT, process.env.WIKI_DIR || "examples/demo-wiki");
const EXCLUDE = new Set(
  (process.env.WIKI_EXCLUDE ?? "INDEX,synthesis")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
);

const PUBLIC = process.env.PUBLIC_DIR ? path.resolve(process.env.PUBLIC_DIR) : path.join(ROOT, "public");
const WIKI_OUT = path.join(PUBLIC, "wiki");

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, files);
    else if (entry.isFile() && entry.name.endsWith(".md")) files.push(full);
  }
  return files;
}

// --- collect files / nodes ---------------------------------------------------
if (!fs.existsSync(WIKI_DIR)) {
  console.error(`[wikilink-graph] WIKI_DIR not found: ${WIKI_DIR}`);
  process.exit(1);
}

const mdFiles = walk(WIKI_DIR);
const nodes = new Map(); // slug -> node

for (const file of mdFiles) {
  const rel = path.relative(WIKI_DIR, file);
  const slug = slugify(file);
  const text = fs.readFileSync(file, "utf8");
  const fmLines = frontmatterLines(text);
  nodes.set(slug, {
    id: slug,
    label: titleFromSlug(slug),
    type: topLevelType(rel),
    file: rel.split(path.sep).join("/"), // served as /wiki/<rel>
    tags: frontmatterTags(fmLines),
    status: pageStatus(fmLines, text),
    ghost: false,
    degree: 0,
    excluded: EXCLUDE.has(slug),
  });
}

// --- extract edges -----------------------------------------------------------
const edges = new EdgeSet();

function ensureGhost(slug) {
  if (!nodes.has(slug)) {
    nodes.set(slug, {
      id: slug,
      label: titleFromSlug(slug),
      type: "ghost",
      file: null,
      tags: [],
      status: null,
      ghost: true,
      degree: 0,
      excluded: false,
    });
  }
}

for (const file of mdFiles) {
  const src = slugify(file);
  const text = fs.readFileSync(file, "utf8");

  for (const target of extractWikilinks(text)) {
    ensureGhost(target);
    edges.add(src, target);
  }

  for (const target of extractMdLinks(text)) {
    ensureGhost(target);
    edges.add(src, target);
  }
}

// --- degrees -------------------------------------------------------------------
// Only "link" edges count toward degree (and therefore node radius): tag edges are an
// opt-in overlay, and toggling them shouldn't resize nodes.
for (const { source, target, kind } of edges.links) {
  if (kind !== "link") continue;
  nodes.get(source).degree++;
  nodes.get(target).degree++;
}

// --- tag-based edges -----------------------------------------------------------
// Every pair of nodes sharing a tag gets an edge, no popularity cap (opt-in, toggled
// off by default in the UI — see Filters.tsx). Grouped by tag so this stays linear in
// (tag membership size), not the full node count.
const byTag = new Map(); // tag -> [slug, ...]
for (const node of nodes.values()) {
  for (const t of node.tags) {
    if (!byTag.has(t)) byTag.set(t, []);
    byTag.get(t).push(node.id);
  }
}
for (const ids of byTag.values()) {
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      edges.add(ids[i], ids[j], "tag");
    }
  }
}

// --- copy md files for static serving ----------------------------------------
fs.rmSync(WIKI_OUT, { recursive: true, force: true });
fs.mkdirSync(WIKI_OUT, { recursive: true });
for (const node of nodes.values()) {
  if (!node.file) continue;
  const dest = path.join(WIKI_OUT, node.file);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(path.join(WIKI_DIR, node.file), dest);
}

// --- emit graph.json ---------------------------------------------------------
fs.mkdirSync(PUBLIC, { recursive: true });
const graph = { meta: { wikiDir: WIKI_DIR }, nodes: [...nodes.values()], links: edges.links };
fs.writeFileSync(path.join(PUBLIC, "graph.json"), JSON.stringify(graph, null, 2));

const linkEdgeCount = graph.links.filter((l) => l.kind === "link").length;
const tagEdgeCount = graph.links.filter((l) => l.kind === "tag").length;
console.log(
  `[wikilink-graph] ${graph.nodes.length} nodes (${graph.nodes.filter((n) => n.ghost).length} ghost), ` +
    `${linkEdgeCount} link edges + ${tagEdgeCount} tag edges from ${WIKI_DIR}`
);
