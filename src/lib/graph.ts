export interface GraphNode {
  id: string;
  label: string;
  type: string;
  file: string | null;
  tags: string[];
  status: string | null;
  ghost: boolean;
  degree: number;
  excluded: boolean;
  // Seeded once (on first appearance) by Graph.tsx's position-push effect via `??=`, then kept in
  // sync with cosmos.gl's own live GPU-simulated position by that same effect's *cleanup*: cosmos
  // itself never writes positions back onto these JS objects mid-simulation, but the cleanup reads
  // `graph.getPointPositions()` for the outgoing node set right before a `data` swap would
  // otherwise discard the mapping, and writes the live x/y back here (PLAN_VISUAL_UPGRADE.md
  // decision 24). So x/y are the node's last-known-live position as of the most recent `data`
  // change, not a frozen mount-time seed — still just a JS-side mirror updated at swap boundaries,
  // not a value cosmos reads from continuously.
  x?: number;
  y?: number;
}

export interface GraphLink {
  source: string | GraphNode;
  target: string | GraphNode;
  kind: "link" | "tag";
}

export interface GraphData {
  meta?: {
    wikiDir?: string;
    // M9 — .wikilink-graph.json's hiddenTypes/hiddenTags, resolved by the parser into the
    // concrete defaults the front end applies when the URL carries no override of its own.
    defaultHiddenTypes?: string[];
    defaultHiddenNodes?: string[];
  };
  nodes: GraphNode[];
  links: GraphLink[];
}

// Curated categorical (muted, Tableau/Observable-10-ish) palette assigned per node type
// (PLAN_VISUAL_UPGRADE.md decisions 39/40) — replaces the earlier bright-primaries set, which
// read as garish/cartoonish. Assignment is a hash of the type name itself (see `colorForType`),
// not the type's position in a discovered-order list, so a given type name always maps to the
// same color regardless of what else exists in the wiki or in what order types were found.
const PALETTE = [
  "#5b7c99", // steel blue
  "#c9922a", // amber
  "#7a8c5a", // moss green
  "#9b7a94", // mauve
  "#a8543f", // brick red
  "#5c8a86", // teal-gray
  "#b8a06a", // soft gold
  "#8c7a6b", // taupe
];
const GHOST_COLOR = "#555";

// djb2-style string hash — deterministic, cheap, good-enough distribution for a handful of
// palette slots (not used for anything security-sensitive).
function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

export function colorForType(type: string): string {
  if (type === "ghost") return GHOST_COLOR;
  return PALETTE[hashString(type) % PALETTE.length];
}

export function nodeRadius(node: GraphNode): number {
  return 3 + Math.sqrt(node.degree) * 1.6;
}

// workspaceWiki's status vocab (active/stable/parked/idea) gets a fixed color each; any other
// status word (this tool stays generic — see PLAN.md decision #18) falls back to a neutral ring
// so it's still visibly "has a status" without inventing a color per word. Deliberately a
// separate, more saturated family from the muted type `PALETTE` above (decision 41) — a status
// ring and a node's fill color encode two different facts and shouldn't be visually confusable.
const STATUS_COLORS: Record<string, string> = {
  active: "#00e5ff",
  stable: "#7c4dff",
  parked: "#ffab00",
  idea: "#ff4081",
};
const STATUS_FALLBACK = "#aab3c0";

export function colorForStatus(status: string | null): string | null {
  if (!status) return null;
  return STATUS_COLORS[status.toLowerCase()] ?? STATUS_FALLBACK;
}

// Graph.tsx's dimming rule, extracted for unit-testability (the canvas painting itself isn't —
// see CLAUDE.md's testing-boundaries note). `focus` is the caller's already-resolved
// hover-or-selected id. Search matches take precedence: while searching, only matches stay lit,
// except a hovered node still lights its own neighbors so you can explore a match's context.
export function isLit(
  id: string,
  focus: string | null,
  hover: string | null,
  neighbors: Map<string, Set<string>>,
  searchIds: Set<string> | null
): boolean {
  if (searchIds) {
    if (hover) return id === hover || (neighbors.get(hover)?.has(id) ?? false);
    return searchIds.has(id);
  }
  return !focus || id === focus || (neighbors.get(focus)?.has(id) ?? false);
}

// Local/global toggle (M6, PLAN_VISUAL_UPGRADE.md decisions 8/9/10) — "local" mode narrows an
// already-filtered graph down to just the selected node plus its direct (fixed 1-hop) neighbors.
// `data` is expected to be the graph *after* the existing type/node/tag filters are applied, and
// `neighbors` the same adjacency map App.tsx builds for hover/selection highlighting (respects
// the tag-edge toggle, ignores the type/node/tag filters) — so composing with those filters is
// just "narrow what's already visible a bit further" (decision 10): a neighbor already excluded
// by an existing filter was never in `data.nodes` to begin with, and never reappears here. No
// selection is a no-op (returns `data` unchanged) — callers decide what "local with nothing
// selected" should mean in the UI (App.tsx disables the toggle in that case).
export function localize(
  data: GraphData,
  selected: string | null,
  neighbors: Map<string, Set<string>>
): GraphData {
  if (!selected) return data;
  const keep = new Set([selected, ...(neighbors.get(selected) ?? [])]);
  const nodes = data.nodes.filter((n) => keep.has(n.id));
  const keptIds = new Set(nodes.map((n) => n.id));
  const links = data.links.filter((l) => {
    const [a, b] = endpointIds(l);
    return keptIds.has(a) && keptIds.has(b);
  });
  return { meta: data.meta, nodes, links };
}

// Single/double-click split (M10g, PLAN_VISUAL_UPGRADE.md decision 50) — replaces decision 25's
// select-vs-open model entirely. Once App.tsx's click-arrival timer (stateful, so it lives there
// rather than here) has decided a click is a genuine single click (not the first half of a
// double-click), this is the pure part: toggle that exact node's selection — clicking the
// already-selected node clears it, clicking any other node replaces the selection with it.
// Double-click (opens the node) and neighbor-lighting no longer factor into the click decision at
// all; a lit neighbor is just visual context now, not a second way to trigger navigation.
export function classifyGraphClick(id: string, currentSelected: string | null): string | null {
  return id === currentSelected ? null : id;
}

// Breathing effect for the 3D hybrid build (PLAN_BREATHING.md) — a pure visual pulse, deliberately
// NOT a physics/simulation effect like Graph.tsx's 2D breathing (decision 1: re-driving
// d3-force-3d risks reintroducing the layout instability 3D was chosen specifically to avoid).
// Returns a scale factor centered on 1.0 (default ±10%) from a sine wave over `elapsedMs`, applied
// uniformly to every node's THREE.Group so the whole ball grows/shrinks in sync (decision 3).
export function breathingScale(elapsedMs: number, periodMs = 6000, amplitude = 0.1): number {
  return 1 + Math.sin((2 * Math.PI * elapsedMs) / periodMs) * amplitude;
}

export function linkId(l: GraphLink): string {
  const s = typeof l.source === "string" ? l.source : l.source.id;
  const t = typeof l.target === "string" ? l.target : l.target.id;
  return `${s} ${t}`;
}

export function endpointIds(l: GraphLink): [string, string] {
  const s = typeof l.source === "string" ? l.source : l.source.id;
  const t = typeof l.target === "string" ? l.target : l.target.id;
  return [s, t];
}
