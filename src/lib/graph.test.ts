// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  colorForType,
  nodeRadius,
  colorForStatus,
  linkId,
  endpointIds,
  isLit,
  localize,
  classifyGraphClick,
} from "./graph";
import type { GraphNode, GraphLink, GraphData } from "./graph";

function node(overrides: Partial<GraphNode> = {}): GraphNode {
  return {
    id: "n1",
    label: "N1",
    type: "root",
    file: "n1.md",
    tags: [],
    status: null,
    ghost: false,
    degree: 0,
    excluded: false,
    ...overrides,
  };
}

describe("colorForType", () => {
  it("assigns a stable, deterministic color per type name", () => {
    expect(colorForType("root")).toBe(colorForType("root"));
    expect(colorForType("concepts")).not.toBe(colorForType("root"));
  });

  it("is independent of discovery order — a type's color never depends on what else exists", () => {
    // unlike the old indexOf-based assignment, calling it standalone vs. alongside other types
    // must yield the exact same color, since only the type's own name feeds the hash.
    expect(colorForType("guides")).toBe(colorForType("guides"));
  });

  it("always returns the ghost color for type 'ghost'", () => {
    expect(colorForType("ghost")).toBe("#555");
  });
});

describe("nodeRadius", () => {
  it("is monotonically non-decreasing in degree", () => {
    const r0 = nodeRadius(node({ degree: 0 }));
    const r1 = nodeRadius(node({ degree: 1 }));
    const r10 = nodeRadius(node({ degree: 10 }));
    expect(r0).toBeLessThan(r1);
    expect(r1).toBeLessThan(r10);
  });

  it("returns a positive radius even at degree 0", () => {
    expect(nodeRadius(node({ degree: 0 }))).toBeGreaterThan(0);
  });
});

describe("colorForStatus", () => {
  it("maps known status words to their fixed colors", () => {
    expect(colorForStatus("active")).toBe("#00e5ff");
    expect(colorForStatus("stable")).toBe("#7c4dff");
  });

  it("is case-insensitive", () => {
    expect(colorForStatus("Active")).toBe(colorForStatus("active"));
  });

  it("falls back to the neutral color for an unknown status word", () => {
    expect(colorForStatus("frobnicating")).toBe("#aab3c0");
  });

  it("returns null for a null status", () => {
    expect(colorForStatus(null)).toBeNull();
  });
});

describe("linkId / endpointIds", () => {
  it("handles string source/target", () => {
    const l: GraphLink = { source: "a", target: "b", kind: "link" };
    expect(linkId(l)).toBe("a b");
    expect(endpointIds(l)).toEqual(["a", "b"]);
  });

  it("handles object source/target (post-d3-force shape)", () => {
    const l: GraphLink = { source: node({ id: "a" }), target: node({ id: "b" }), kind: "link" };
    expect(linkId(l)).toBe("a b");
    expect(endpointIds(l)).toEqual(["a", "b"]);
  });

  it("handles a mixed string/object pair", () => {
    const l: GraphLink = { source: "a", target: node({ id: "b" }), kind: "link" };
    expect(linkId(l)).toBe("a b");
    expect(endpointIds(l)).toEqual(["a", "b"]);
  });
});

describe("isLit", () => {
  const neighbors = new Map<string, Set<string>>([
    ["a", new Set(["b", "c"])],
    ["b", new Set(["a"])],
  ]);

  it("lights everything when there's no focus, hover, or search", () => {
    expect(isLit("a", null, null, neighbors, null)).toBe(true);
    expect(isLit("z", null, null, neighbors, null)).toBe(true);
  });

  it("lights only the focused node and its neighbors when there's a focus and no search", () => {
    expect(isLit("a", "a", null, neighbors, null)).toBe(true);
    expect(isLit("b", "a", null, neighbors, null)).toBe(true);
    expect(isLit("c", "a", null, neighbors, null)).toBe(true);
    expect(isLit("z", "a", null, neighbors, null)).toBe(false);
  });

  it("while searching with no hover, only search matches are lit", () => {
    const searchIds = new Set(["c"]);
    expect(isLit("c", "a", null, neighbors, searchIds)).toBe(true);
    expect(isLit("a", "a", null, neighbors, searchIds)).toBe(false);
    expect(isLit("b", "a", null, neighbors, searchIds)).toBe(false);
  });

  it("while searching, a hovered node overrides search matches and lights its own neighbors instead", () => {
    const searchIds = new Set(["c"]);
    expect(isLit("b", "b", "b", neighbors, searchIds)).toBe(true);
    expect(isLit("a", "b", "b", neighbors, searchIds)).toBe(true);
    expect(isLit("c", "b", "b", neighbors, searchIds)).toBe(false);
  });
});

describe("localize", () => {
  // a - b - c, and a - d (a's the hub); e is disconnected entirely.
  const data: GraphData = {
    nodes: [
      node({ id: "a", label: "A" }),
      node({ id: "b", label: "B" }),
      node({ id: "c", label: "C" }),
      node({ id: "d", label: "D" }),
      node({ id: "e", label: "E" }),
    ],
    links: [
      { source: "a", target: "b", kind: "link" },
      { source: "b", target: "c", kind: "link" },
      { source: "a", target: "d", kind: "link" },
    ],
  };
  const neighbors = new Map<string, Set<string>>([
    ["a", new Set(["b", "d"])],
    ["b", new Set(["a", "c"])],
    ["c", new Set(["b"])],
    ["d", new Set(["a"])],
  ]);

  it("returns the data unchanged when nothing is selected (no-op)", () => {
    expect(localize(data, null, neighbors)).toBe(data);
  });

  it("narrows to the selected node plus its direct neighbors", () => {
    const result = localize(data, "a", neighbors);
    expect(result.nodes.map((n) => n.id).sort()).toEqual(["a", "b", "d"]);
  });

  it("keeps only links between nodes that survived the narrowing", () => {
    const result = localize(data, "a", neighbors);
    // a-b and a-d survive; b-c is dropped since c isn't in the local set.
    expect(result.links.map(linkId).sort()).toEqual(["a b", "a d"]);
  });

  it("2-hop nodes are excluded — depth is fixed at 1", () => {
    const result = localize(data, "a", neighbors);
    expect(result.nodes.some((n) => n.id === "c")).toBe(false);
  });

  it("a selected node with no neighbors keeps just itself, and no links", () => {
    const result = localize(data, "e", neighbors);
    expect(result.nodes.map((n) => n.id)).toEqual(["e"]);
    expect(result.links).toEqual([]);
  });

  it("composes with pre-filtering — a neighbor already removed from `data` upstream stays absent", () => {
    // Simulate an existing hidden-type/tag filter having already dropped "d" from the input
    // graph, even though the (unfiltered) neighbors map still lists it as a's neighbor.
    const preFiltered: GraphData = {
      nodes: data.nodes.filter((n) => n.id !== "d"),
      links: data.links.filter((l) => linkId(l) !== "a d"),
    };
    const result = localize(preFiltered, "a", neighbors);
    expect(result.nodes.map((n) => n.id).sort()).toEqual(["a", "b"]);
  });

  it("preserves the input's meta", () => {
    const withMeta: GraphData = { ...data, meta: { wikiDir: "/x" } };
    const result = localize(withMeta, "a", neighbors);
    expect(result.meta).toEqual({ wikiDir: "/x" });
  });
});

describe("classifyGraphClick", () => {
  it("selects a node when nothing is currently selected", () => {
    expect(classifyGraphClick("a", null)).toBe("a");
  });

  it("clears the selection when the clicked node is already selected", () => {
    expect(classifyGraphClick("a", "a")).toBeNull();
  });

  it("replaces the selection with whatever other node was clicked", () => {
    expect(classifyGraphClick("b", "a")).toBe("b");
  });
});
