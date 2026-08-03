// Pure, side-effect-free helpers for scripts/parse-wiki.mjs — no fs/process.env access,
// so these can be unit tested directly without touching the filesystem or WIKI_DIR. See
// ../../PLAN_TESTING.md Phase 1.

import path from "node:path";

// slug = filename without extension, lowercased (matches this wiki's [[slug]] convention)
export const slugify = (p) => path.basename(p, ".md").toLowerCase();
export const titleFromSlug = (s) => s.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

export function topLevelType(relPath) {
  const parts = relPath.split(path.sep);
  return parts.length > 1 ? parts[0] : "root";
}

// Split out the leading YAML frontmatter block, if any, into its lines.
export function frontmatterLines(text) {
  const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  return fm ? fm[1].split(/\r?\n/) : null;
}

// Pull `tags:` out of frontmatter lines, if any.
// Supports `tags: [a, b]`, `tags: a, b`, and a block list of `- a` lines.
export function frontmatterTags(lines) {
  if (!lines) return [];
  const i = lines.findIndex((l) => /^tags\s*:/.test(l));
  if (i === -1) return [];
  const inline = lines[i].replace(/^tags\s*:/, "").trim();
  const clean = (s) => s.replace(/^["'\[\]]+|["'\[\]]+$/g, "").trim();
  if (inline) return inline.split(",").map(clean).filter(Boolean);
  const out = [];
  for (let j = i + 1; j < lines.length && /^\s*-\s+/.test(lines[j]); j++) {
    out.push(clean(lines[j].replace(/^\s*-\s+/, "")));
  }
  return out.filter(Boolean);
}

// Pull a scalar `status:` key out of frontmatter lines, if present.
export function frontmatterStatus(lines) {
  if (!lines) return null;
  const line = lines.find((l) => /^status\s*:/.test(l));
  if (!line) return null;
  const v = line.replace(/^status\s*:/, "").trim().replace(/^["']+|["']+$/g, "");
  return v || null;
}

// Fall back to workspaceWiki's prose convention: a `**Status** <word>` line in the body
// (e.g. "**Path** ... · **Stack** ... · **Status** stable"). Tried only when no YAML
// `status:` key is present, so both formats work without a page needing to pick one.
// Anchored to end-of-line so ordinary prose that happens to say "**Status** shows..."
// doesn't get mistaken for a real status declaration — the real convention always has
// the status word as the last thing on its line.
export function proseStatus(text) {
  const m = text.match(/\*\*Status\*\*\s+([a-zA-Z][\w-]*)\s*$/m);
  return m ? m[1] : null;
}

export function pageStatus(fmLines, text) {
  return frontmatterStatus(fmLines) ?? proseStatus(text);
}

const WIKILINK = /\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g;
const MDLINK = /\[[^\]]*\]\(([^)]+)\)/g;

// Returns the slugified targets of every [[wikilink]] in text (raw extraction only —
// ghost-node creation and edge dedup stay with the caller, which owns the shared node map).
export function extractWikilinks(text) {
  const out = [];
  for (const m of text.matchAll(WIKILINK)) {
    out.push(slugify(m[1].trim()));
  }
  return out;
}

// Returns the slugified targets of every relative [text](rel/page.md) markdown link in text.
// Ignores external http(s) links, mailto:, anchor-only (#...) links, and non-.md targets
// (e.g. path:line source citations).
export function extractMdLinks(text) {
  const out = [];
  for (const m of text.matchAll(MDLINK)) {
    const href = m[1].trim();
    if (/^[a-z]+:\/\//i.test(href) || href.startsWith("#") || href.startsWith("mailto:")) continue;
    if (!href.toLowerCase().endsWith(".md")) continue;
    out.push(slugify(href.split("#")[0]));
  }
  return out;
}

export function buildEdgeKey(kind, a, b) {
  return `${kind}:${[a, b].sort().join(" ")}`;
}

// Wraps the existing dedup logic: undirected edges keyed by kind + sorted endpoint pair, so
// mutual links collapse to one edge, and "link" vs "tag" edges between the same pair coexist.
export class EdgeSet {
  constructor() {
    this._seen = new Set();
    this.links = [];
  }
  add(a, b, kind = "link") {
    if (!a || !b || a === b) return false;
    const key = buildEdgeKey(kind, a, b);
    if (this._seen.has(key)) return false;
    this._seen.add(key);
    this.links.push({ source: a, target: b, kind });
    return true;
  }
}
