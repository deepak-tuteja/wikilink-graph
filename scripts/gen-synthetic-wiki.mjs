#!/usr/bin/env node
// Generates examples/synthetic-wiki/ — a configurable-size (default ~1000 nodes), fully synthetic
// [[slug]]-linked markdown wiki with no dependency on real workspace content, purpose-built to
// make WebGL clustering/bloom visually legible once the @cosmograph/cosmos engine swap (M3) lands
// (the real workspaceWiki tops out around ~40 nodes, too small to justify a GPU renderer).
//
// Type distribution: 5 folder types (concepts/features/guides/reference/projects, weighted so
// clusters read as visibly different sizes) plus 5 root-level pages (index/glossary/decisions/
// synthesis/roadmap) — each root page gets its own filename-stem type per M1's schema fix, so this
// fixture also doubles as a scale exercise of that change.
//
// Linking is a Barabási–Albert-style preferential-attachment model: each page's slug is pushed
// into a selection pool once at creation and again every time it receives an incoming link, so
// later pages are more likely to link to already-popular ones. That snowballs a few pages per
// type into visible hubs instead of every page landing at near-identical degree — the kind of
// structure a force/cluster layout actually has something to do with. A small fraction of links
// deliberately target nonexistent slugs, so ghost nodes show up at scale too.
//
// Gitignored, regenerated on demand:
//   node scripts/gen-synthetic-wiki.mjs [nodeCount=1000] [ghostProb=0.04] [minLinks=1] [maxLinks=4]
// The last three tune density/ghosts for layout experiments (e.g. a tightly-connected,
// zero-ghost variant for visual-shape testing) without touching the documented ~1000/~100-ghost
// default (CLAUDE.md's testing-boundaries note pins that default combo specifically).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "examples", "synthetic-wiki");

const TOTAL = Math.max(10, parseInt(process.argv[2], 10) || 1000);
const GHOST_PROB = process.argv[3] !== undefined ? parseFloat(process.argv[3]) : 0.04;
const MIN_LINKS = Math.max(1, parseInt(process.argv[4], 10) || 1);
const MAX_LINKS = Math.max(MIN_LINKS, parseInt(process.argv[5], 10) || 4);

const ROOT_PAGES = ["index", "glossary", "decisions", "synthesis", "roadmap"];

const TYPE_DEFS = [
  { name: "concepts", weight: 0.3 },
  { name: "features", weight: 0.24 },
  { name: "guides", weight: 0.2 },
  { name: "reference", weight: 0.16 },
  { name: "projects", weight: 0.1 },
];

const ADJECTIVES = [
  "adaptive", "asynchronous", "canonical", "cascading", "causal", "composable", "declarative",
  "distributed", "dynamic", "emergent", "ephemeral", "explicit", "federated", "granular",
  "heuristic", "hierarchical", "immutable", "implicit", "incremental", "layered", "lexical",
  "modular", "nested", "normalized", "observable", "polymorphic", "recursive", "resilient",
  "stochastic", "synthetic",
];
const NOUNS = [
  "adapter", "anchor", "artifact", "boundary", "cache", "cluster", "constraint", "contract",
  "dependency", "embedding", "endpoint", "gradient", "graph", "heuristic", "index", "invariant",
  "lattice", "ledger", "lifecycle", "manifold", "matrix", "milestone", "module", "observer",
  "pipeline", "pointer", "protocol", "proxy", "registry", "schema", "sequence", "signal",
  "snapshot", "state", "stream", "surface", "threshold", "topology", "trace", "workflow",
];
const TAGS = [
  "performance", "security", "onboarding", "deprecated", "experimental", "core", "ui", "backend",
  "infra", "research", "draft", "stable", "breaking-change", "migration", "tooling",
  "observability", "scaling", "latency", "consistency", "availability", "testing", "automation",
  "design", "architecture", "governance",
];
const STATUSES = ["draft", "stable", "deprecated", "in-review"];

function shuffle(arr) {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function titleCase(slug) {
  return slug.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// A shuffled pool of adjective-noun combos, falling back to a numeric suffix once exhausted, so
// slugs stay unique (and still legible) at any requested scale.
function makeSlugPool() {
  const combos = [];
  for (const a of ADJECTIVES) for (const n of NOUNS) combos.push(`${a}-${n}`);
  return shuffle(combos);
}

// --- distribute node counts across types --------------------------------------------------
const folderTotal = TOTAL - ROOT_PAGES.length;
const weightSum = TYPE_DEFS.reduce((s, t) => s + t.weight, 0);
let assigned = 0;
const counts = TYPE_DEFS.map((t, i) => {
  const isLast = i === TYPE_DEFS.length - 1;
  const n = isLast ? folderTotal - assigned : Math.round((t.weight / weightSum) * folderTotal);
  assigned += n;
  return { ...t, count: Math.max(1, n) };
});

// --- build the node list in creation order (root pages first, so they naturally accrue the
// highest degree as early "hub" pages under preferential attachment below) -----------------
const slugPool = makeSlugPool();
let slugCursor = 0;
let slugSuffix = 1;
function nextSlug() {
  if (slugCursor < slugPool.length) return slugPool[slugCursor++];
  return `${slugPool[slugCursor % slugPool.length]}-${++slugSuffix}`;
}

const order = []; // [{ slug, type }], type == slug for root pages (M1 schema)
for (const name of ROOT_PAGES) order.push({ slug: name, type: name });
for (const t of counts) {
  for (let i = 0; i < t.count; i++) order.push({ slug: nextSlug(), type: t.name });
}
const typeOf = new Map(order.map((n) => [n.slug, n.type]));

// --- preferential-attachment linking -------------------------------------------------------
const poolByType = new Map();
const poolGlobal = [];
function poolFor(type) {
  if (!poolByType.has(type)) poolByType.set(type, []);
  return poolByType.get(type);
}
function reinforce(slug, type) {
  poolFor(type).push(slug);
  poolGlobal.push(slug);
}

const links = new Map(); // slug -> [{ target, ghost }]
for (const node of order) {
  const outLinks = [];
  const m = MIN_LINKS + Math.floor(Math.random() * (MAX_LINKS - MIN_LINKS + 1));
  const sameTypePool = poolFor(node.type);
  for (let i = 0; i < m; i++) {
    if (Math.random() < GHOST_PROB) {
      // Deliberate dangling link — no page will ever exist at this slug, so it becomes a ghost.
      outLinks.push({ target: `missing-${pick(ADJECTIVES)}-${pick(NOUNS)}`, ghost: true });
      continue;
    }
    // Was 0.75 — that strong a same-type bias produces near-disjoint per-type communities that
    // the 3D force layout settles into separate isolated patches on the ball's surface (visible
    // gaps of empty space between them) rather than an evenly filled sphere. More cross-type
    // links pull the communities together without erasing the color clustering entirely.
    const useSameType = sameTypePool.length > 0 && Math.random() < 0.55;
    const pool = useSameType ? sameTypePool : poolGlobal;
    if (pool.length === 0) continue; // nothing exists yet (only true for the very first page)
    const target = pick(pool);
    if (target === node.slug || outLinks.some((l) => l.target === target)) continue;
    outLinks.push({ target, ghost: false });
  }
  links.set(node.slug, outLinks);
  reinforce(node.slug, node.type);
  for (const { target, ghost } of outLinks) {
    if (!ghost) reinforce(target, typeOf.get(target));
  }
}

// Give index.md a few curated cross-type links (one from each type's first-created page, plus
// glossary/decisions) so it reads as a genuine discoverable hub rather than whatever it happened
// to roll at the very start of the preferential-attachment pass, when nothing existed yet to link to.
const indexLinks = links.get("index");
const curated = [];
for (const t of counts) {
  const firstOfType = order.find((n) => n.type === t.name);
  if (firstOfType) curated.push({ target: firstOfType.slug, ghost: false });
}
curated.push({ target: "glossary", ghost: false }, { target: "decisions", ghost: false });
for (const c of curated) {
  if (!indexLinks.some((l) => l.target === c.target)) indexLinks.push(c);
}

// --- render page content -------------------------------------------------------------------
function frontmatter(tags, status) {
  if (!tags.length && !status) return "";
  const lines = ["---"];
  if (status) lines.push(`status: ${status}`);
  if (tags.length) lines.push(`tags: [${tags.join(", ")}]`);
  lines.push("---", "");
  return lines.join("\n");
}

function body(node, outLinks) {
  const title = titleCase(node.slug);
  const intro = `A synthetic ${node.type} page generated for wikilink-graph's rendering-engine showcase fixture.`;
  const prose = outLinks.length
    ? ` It connects to ${outLinks.map((l) => `[[${l.target}]]`).join(", ")}.`
    : "";
  const seeAlso = outLinks.length
    ? `\n\n## See also\n\n${outLinks.map((l) => `- [[${l.target}]]`).join("\n")}\n`
    : "\n";
  return `# ${title}\n\n${intro}${prose}${seeAlso}`;
}

// --- write files -----------------------------------------------------------------------------
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const realSlugs = new Set(order.map((n) => n.slug));
let ghostLinkCount = 0;

for (const node of order) {
  const outLinks = links.get(node.slug);
  for (const l of outLinks) {
    if (l.ghost || !realSlugs.has(l.target)) ghostLinkCount++;
  }

  const tags = Math.random() < 0.4 ? shuffle(TAGS).slice(0, 1 + Math.floor(Math.random() * 2)) : [];
  const status = Math.random() < 0.3 ? pick(STATUSES) : null;
  const text = frontmatter(tags, status) + body(node, outLinks);

  const dest = ROOT_PAGES.includes(node.slug)
    ? path.join(OUT, `${node.slug}.md`)
    : path.join(OUT, node.type, `${node.slug}.md`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, text);
}

console.log(`[gen-synthetic-wiki] ${order.length} pages -> ${OUT}`);
console.log(`  root pages (own type each): ${ROOT_PAGES.join(", ")}`);
for (const t of counts) console.log(`  ${t.name}: ${t.count} pages`);
console.log(`  ~${ghostLinkCount} deliberate dangling links (become ghost nodes)`);
console.log(`  run: WIKI_DIR=examples/synthetic-wiki npm run dev`);
