// @vitest-environment node
import { describe, it, expect } from "vitest";
import { colorForType, nodeRadius, colorForStatus, linkId, endpointIds, forceCluster } from "./graph";
import type { GraphNode, GraphLink } from "./graph";

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
  const types = ["root", "concepts", "guides"];

  it("assigns a stable color by index into the given types list", () => {
    expect(colorForType("root", types)).toBe(colorForType("root", types));
    expect(colorForType("concepts", types)).not.toBe(colorForType("root", types));
  });

  it("always returns the ghost color for type 'ghost', regardless of the types list", () => {
    expect(colorForType("ghost", types)).toBe("#555");
  });

  it("wraps around the palette when there are more types than colors", () => {
    const manyTypes = Array.from({ length: 10 }, (_, i) => `t${i}`);
    // palette has 7 entries, so index 7 should wrap to the same color as index 0
    expect(colorForType("t7", manyTypes)).toBe(colorForType("t0", manyTypes));
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
    expect(colorForStatus("active")).toBe("#63e6be");
    expect(colorForStatus("stable")).toBe("#6ea8fe");
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

describe("forceCluster", () => {
  it("initializes with an empty node array and ticking doesn't throw", () => {
    const force = forceCluster();
    force.initialize([]);
    expect(() => force(1)).not.toThrow();
  });

  it("ticking doesn't throw with a single positioned node", () => {
    const force = forceCluster();
    force.initialize([node({ id: "a", type: "root", x: 0, y: 0 })]);
    expect(() => force(1)).not.toThrow();
  });

  it("ticking doesn't throw with multiple same-type positioned nodes", () => {
    const force = forceCluster();
    force.initialize([
      node({ id: "a", type: "root", x: 0, y: 0 }),
      node({ id: "b", type: "root", x: 10, y: 10 }),
      node({ id: "c", type: "concepts", x: -5, y: 5 }),
    ]);
    expect(() => force(0.5)).not.toThrow();
  });
});
