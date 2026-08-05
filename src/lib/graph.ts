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
  // injected by react-force-graph (d3-force) at runtime
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  // d3-force pin — set while a node is hovered so it can't drift out from under the cursor
  // (Graph.tsx), even though its neighbors still get repelled outward around it.
  fx?: number | null;
  fy?: number | null;
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

// Stable, distinct palette assigned per node type.
const PALETTE = [
  "#6ea8fe", // blue
  "#63e6be", // teal
  "#ffd43b", // yellow
  "#ff8787", // red
  "#da77f2", // purple
  "#ffa94d", // orange
  "#74c0fc", // light blue
];
const GHOST_COLOR = "#555";

export function colorForType(type: string, types: string[]): string {
  if (type === "ghost") return GHOST_COLOR;
  const i = types.indexOf(type);
  return PALETTE[i % PALETTE.length] ?? "#999";
}

export function nodeRadius(node: GraphNode): number {
  return 3 + Math.sqrt(node.degree) * 1.6;
}

// workspaceWiki's status vocab (active/stable/parked/idea) gets a fixed color each; any other
// status word (this tool stays generic — see PLAN.md decision #18) falls back to a neutral ring
// so it's still visibly "has a status" without inventing a color per word.
const STATUS_COLORS: Record<string, string> = {
  active: "#63e6be",
  stable: "#6ea8fe",
  parked: "#ffd43b",
  idea: "#da77f2",
};
const STATUS_FALLBACK = "#aab3c0";

export function colorForStatus(status: string | null): string | null {
  if (!status) return null;
  return STATUS_COLORS[status.toLowerCase()] ?? STATUS_FALLBACK;
}

// d3-force custom force: nudges same-type nodes toward their shared centroid each tick, so
// clusters emerge without pinning nodes to fixed positions. Ghosts cluster on their own (type
// "ghost"), keeping them visually distinct from the real pages that link to them.
export function forceCluster(strength = 0.4) {
  let nodes: GraphNode[] = [];
  function force(alpha: number) {
    const centroids = new Map<string, { x: number; y: number; count: number }>();
    for (const n of nodes) {
      if (n.x == null || n.y == null) continue;
      let c = centroids.get(n.type);
      if (!c) { c = { x: 0, y: 0, count: 0 }; centroids.set(n.type, c); }
      c.x += n.x; c.y += n.y; c.count++;
    }
    for (const c of centroids.values()) { c.x /= c.count; c.y /= c.count; }
    const k = strength * alpha;
    for (const n of nodes) {
      if (n.x == null || n.y == null) continue;
      const c = centroids.get(n.type);
      if (!c || c.count < 2) continue;
      n.vx = (n.vx ?? 0) - (n.x - c.x) * k;
      n.vy = (n.vy ?? 0) - (n.y - c.y) * k;
    }
  }
  force.initialize = (ns: GraphNode[]) => { nodes = ns; };
  return force;
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
