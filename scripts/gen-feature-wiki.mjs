#!/usr/bin/env node
// Generates examples/feature-wiki/ — a realistic-scale (37-page) fixture derived from a snapshot
// of workspaceWiki/wiki/, transformed to exercise wikilink-graph's frontmatter-aware features
// (status ring, tags-as-edges) that the real wiki doesn't use yet.
//
// For each project page (the ones with a `**Path** · **Stack** · **Skill(s)** · **Status** <word>`
// template line), alternately:
//   - leave the prose `**Status** <word>` line as-is, or
//   - strip it and add YAML frontmatter `status:` + synthetic `tags:` derived from the Stack line
// so both status formats (see decision #18 in PLAN.md) get real, roughly-even coverage. Pages
// without that template line (concept pages, decisions.md, synthesis.md, INDEX.md) are copied
// unchanged — they demonstrate the "no status, no tags" case at scale.
//
// Gitignored, regenerated on demand: node scripts/gen-feature-wiki.mjs [sourceWikiDir]

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const SRC = path.resolve(ROOT, process.argv[2] || "../workspaceWiki/wiki");
const OUT = path.join(ROOT, "examples", "feature-wiki");

if (!fs.existsSync(SRC)) {
  console.error(`[gen-feature-wiki] source wiki not found: ${SRC}`);
  process.exit(1);
}

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, files);
    else if (entry.isFile() && entry.name.endsWith(".md")) files.push(full);
  }
  return files;
}

const TEMPLATE_LINE = /^\*\*Path\*\*.*\*\*Status\*\*\s+(\S+)\s*$/m;
const STACK = /\*\*Stack\*\*\s+(.*?)\s+·\s+\*\*Skills?\*\*/s;

// Pull tech-looking capitalized words out of the Stack line (e.g. "Vite + React Three Fiber" ->
// ["vite", "react", "three", "fiber"]), dedupe, cap at 5 so tag clouds stay readable.
function tagsFromStack(stackText) {
  if (!stackText) return [];
  const words = stackText.match(/[A-Z][A-Za-z0-9.]*/g) ?? [];
  const stop = new Set(["Node"]);
  const tags = [];
  for (const w of words) {
    const t = w.toLowerCase().replace(/\.$/, "");
    if (stop.has(w) || t.length < 3 || tags.includes(t)) continue;
    tags.push(t);
    if (tags.length >= 5) break;
  }
  return tags;
}

function toFrontmatter(text, status, tags) {
  const body = text.replace(TEMPLATE_LINE, (line) => line.replace(/\s*·\s*\*\*Status\*\*\s+\S+\s*$/, ""));
  const lines = ["---", `status: ${status}`];
  if (tags.length) lines.push(`tags: [${tags.join(", ")}]`);
  lines.push("---", "");
  return lines.join("\n") + body;
}

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const files = walk(SRC);
let converted = 0;
let untouched = 0;
let skipped = 0;
let projectIndex = 0;

for (const file of files) {
  const rel = path.relative(SRC, file);
  const text = fs.readFileSync(file, "utf8");
  const m = text.match(TEMPLATE_LINE);

  let out = text;
  if (!m) {
    skipped++;
  } else {
    const status = m[1];
    const isConvert = projectIndex % 2 === 0;
    projectIndex++;
    if (isConvert) {
      const stackMatch = text.match(STACK);
      const tags = tagsFromStack(stackMatch?.[1]);
      out = toFrontmatter(text, status, tags);
      converted++;
    } else {
      untouched++;
    }
  }

  const dest = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, out);
}

console.log(
  `[gen-feature-wiki] ${files.length} pages from ${SRC} -> ${OUT}\n` +
    `  ${converted} converted to YAML status+tags, ${untouched} kept prose **Status** line, ` +
    `${skipped} unchanged (no template line)`
);
