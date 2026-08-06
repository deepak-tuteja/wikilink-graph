import { useEffect, useMemo, useRef } from "react";
import ForceGraph3D, { type ForceGraphMethods } from "react-force-graph-3d";
import { forceRadial } from "d3-force-3d";
import type { GraphData, GraphNode } from "../lib/graph";
import { colorForType, nodeRadius, endpointIds } from "../lib/graph";
import type { Theme } from "../lib/theme";
import { GRAPH_PALETTE } from "../lib/theme";

// PLAN_3D.md spike — throwaway, kept fully separate from Graph.tsx (cosmos.gl, 2D). Bare-minimum
// feature scope only (decision 5): load + render + orbit-rotate + hover label. No click/select,
// search, filters, or theme-reactive restyle wiring — this exists purely to answer "does a
// rotatable 3D ball read better than the 2D compaction fight (M10p)," nothing else.
interface Props {
  data: GraphData;
  theme: Theme;
}

interface Node3D {
  id: string;
  label: string;
  type: string;
  degree: number;
}

// forceRadial (decision 4) pulls each node toward a fixed target radius from the origin,
// independent of other nodes' positions — unlike the rejected simulationCluster attempts in
// Graph.tsx (M10l and its predecessor), which pulled nodes toward a shared centroid and collapsed
// the whole graph onto a 1D line. Radius scales with node count (cube root, since nodes are
// distributed over a sphere's surface/volume) so both the tiny demo-wiki and the ~1000-node
// synthetic-wiki fixture get a reasonably dense-but-legible ball rather than one fixed radius
// that's too tight for one and too sparse for the other.
function radialTargetFor(nodeCount: number): number {
  return Math.max(120, Math.cbrt(nodeCount) * 40);
}

export function Graph3D({ data, theme }: Props) {
  const fgRef = useRef<ForceGraphMethods<Node3D> | undefined>(undefined);

  const graphData = useMemo(() => {
    const nodeById = new Map<string, GraphNode>(data.nodes.map((n) => [n.id, n]));
    const nodes: Node3D[] = data.nodes.map((n) => ({
      id: n.id,
      label: n.label,
      type: n.type,
      degree: n.degree,
    }));
    const links = data.links
      .map((l) => {
        const [a, b] = endpointIds(l);
        return nodeById.has(a) && nodeById.has(b) ? { source: a, target: b } : null;
      })
      .filter((l): l is { source: string; target: string } => l !== null);
    return { nodes, links };
  }, [data]);

  // react-force-graph-3d (kapsule pattern) applies a new `graphData` prop via its own internal
  // digest — the only place `state.layout` (the underlying d3 force simulation the tick loop
  // reads) gets (re)built — and that digest is `lodash.debounce(updateFn, 1)` (source:
  // node_modules/kapsule/dist/kapsule.mjs), i.e. a 1ms setTimeout, NOT a requestAnimationFrame.
  // Calling `d3ReheatSimulation()` sets `engineRunning = true` immediately (it only touches
  // `state.d3ForceLayout`, a separate always-present object — see
  // node_modules/three-forcegraph/dist/three-forcegraph.mjs), so if it runs before that 1ms
  // digest has fired, the already-running tick loop hits `state.layout` still unset on the very
  // next frame and throws "Cannot read properties of undefined (reading 'tick')", killing the
  // animation loop outright (canvas goes solid black, confirmed by removing this call entirely —
  // zero errors, graph renders without it).
  //
  // A single `requestAnimationFrame` defer is NOT a reliable fix for this: it races an rAF
  // callback against an unrelated setTimeout(1), and rAF-vs-setTimeout ordering isn't
  // spec-guaranteed. That race happened to resolve correctly on Chromium (rAF is vsync-paced,
  // usually ~16ms — comfortably after the 1ms timer) but reproduced the identical black-screen
  // crash on Firefox, where the scheduler can fire the rAF callback before the 1ms timer elapses
  // (found live 2026-08-06 — Chrome loaded fine, Firefox didn't; the Playwright session used to
  // "verify" the original fix only ever drove Chromium, so the Firefox-only race was never
  // actually tested). setTimeout ordering between two timers IS spec-guaranteed (fires in
  // absolute-deadline order), so deferring via a plain `setTimeout` with a delay well past the
  // digest's 1ms window removes the cross-browser race entirely instead of gambling on it.
  useEffect(() => {
    const fg = fgRef.current;
    if (!fg) return;
    const radius = radialTargetFor(graphData.nodes.length);
    const timer = setTimeout(() => {
      // Default `center` force pulls every node toward r=0, which directly fights a radial
      // target of r=R — disabled so the radial constraint alone decides the resting distance
      // from origin. Charge (repulsion) and link (spring) stay at their library defaults per
      // decision 4.
      fg.d3Force("center", null);
      fg.d3Force("radial", forceRadial(radius, 0, 0, 0).strength(0.4));
      fg.d3ReheatSimulation();
    }, 50);
    return () => clearTimeout(timer);
  }, [graphData]);

  return (
    <div className="graph" style={{ background: GRAPH_PALETTE[theme].background }}>
      <ForceGraph3D<Node3D>
        ref={fgRef}
        graphData={graphData}
        backgroundColor={GRAPH_PALETTE[theme].background}
        nodeLabel="label"
        nodeVal={(n) => nodeRadius(n as unknown as GraphNode)}
        nodeColor={(n) => colorForType(n.type)}
        nodeOpacity={0.9}
        linkOpacity={0.25}
        linkColor={() => GRAPH_PALETTE[theme].linkOff}
        showNavInfo={false}
      />
    </div>
  );
}
