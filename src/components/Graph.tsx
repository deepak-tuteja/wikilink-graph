import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import GraphologyGraph from "graphology";
import Sigma from "sigma";
import type { NodeDisplayData, EdgeDisplayData } from "sigma/types";
import { NodeBorderProgram, createNodeBorderProgram } from "@sigma/node-border";
import { forceSimulation, forceLink, forceManyBody, forceCenter, type Simulation } from "d3-force";
import type { GraphData, GraphNode, GraphLink } from "../lib/graph";
import { colorForType, colorForStatus, nodeRadius, endpointIds, forceCluster, isLit } from "../lib/graph";
import { fitTransform } from "../lib/minimap";
import type { Theme } from "../lib/theme";
import { GRAPH_PALETTE } from "../lib/theme";
import { Minimap } from "./Minimap";

interface Props {
  data: GraphData;
  types: string[];
  neighbors: Map<string, Set<string>>;
  selected: string | null;
  searchIds: Set<string> | null;
  theme: Theme;
  onSelect: (id: string) => void;
}

// M10 — exposes a PNG snapshot of the current view to App.tsx via a ref. Sigma renders across
// several stacked canvases (background/edges/nodes/labels/hovers, see exportSigmaPNG below)
// instead of ForceGraph2D's single one, so the snapshot has to composite them first.
export interface GraphHandle {
  exportPNG: () => string | null;
}

// A thick (75%), mostly-hollow border — the WebGL-native replacement for the old canvas
// dashed-stroke ghost encoding (line-dashing isn't expressible in a GPU node program). Status
// rings and the selection outline reuse @sigma/node-border's own default thin (10%) program.
const GhostNodeProgram = createNodeBorderProgram({
  borders: [{ size: { value: 0.75, mode: "relative" }, color: { attribute: "borderColor" } }],
});

function withAlpha(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}

// Live, always-current snapshot of the props/derived state the persistent nodeReducer/edgeReducer
// closures (registered once, at mount) need to read — Sigma's reducers aren't React, so they can't
// depend on hook closures the way a re-rendered JSX tree would.
interface RenderState {
  focus: string | null;
  hover: string | null;
  selected: string | null;
  searchIds: Set<string> | null;
  neighbors: Map<string, Set<string>>;
  types: string[];
  theme: Theme;
}

export const Graph = forwardRef<GraphHandle, Props>(function Graph(
  { data, types, neighbors, selected, searchIds, theme, onSelect },
  ref
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sigmaRef = useRef<Sigma | null>(null);
  const graphRef = useRef<GraphologyGraph | null>(null);
  const simRef = useRef<Simulation<GraphNode, GraphLink> | null>(null);
  const nodeByIdRef = useRef<Map<string, GraphNode>>(new Map());
  const hoverRef = useRef<string | null>(null);
  const prevHoverRef = useRef<string | null>(null);
  const onSelectRef = useRef(onSelect);
  const [hover, setHover] = useState<string | null>(null);

  const focus = hover ?? selected;
  const stateRef = useRef<RenderState>({
    focus,
    hover,
    selected,
    searchIds,
    neighbors,
    types,
    theme,
  });

  useImperativeHandle(ref, () => ({
    exportPNG: () => exportSigmaPNG(sigmaRef.current, GRAPH_PALETTE[theme].background),
  }));

  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  // Mount once: build the graphology graph, a persistent d3-force simulation (unchanged
  // forceCluster physics), and the Sigma WebGL renderer on top of it. Reducers read `stateRef`
  // (always current) rather than closing over props, since they're registered a single time here.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const g = new GraphologyGraph({ type: "undirected", multi: true });
    graphRef.current = g;

    const sim = forceSimulation<GraphNode>()
      .force(
        "link",
        forceLink<GraphNode, GraphLink>().id((n) => n.id).distance(40)
      )
      .force("charge", forceManyBody<GraphNode>().strength((n) => (n.id === hoverRef.current ? -90 : -30)))
      .force("center", forceCenter(0, 0))
      .force("cluster", forceCluster());
    sim.on("tick", () => {
      const gr = graphRef.current;
      if (!gr) return;
      gr.updateEachNodeAttributes(
        (id, attr) => {
          const n = nodeByIdRef.current.get(id);
          return n ? { ...attr, x: n.x ?? attr.x, y: n.y ?? attr.y } : attr;
        },
        { attributes: ["x", "y"] }
      );
      sigmaRef.current?.refresh({ skipIndexation: true });
    });
    simRef.current = sim;

    const sigma = new Sigma(g, container, {
      defaultNodeType: "circle",
      nodeProgramClasses: { ring: NodeBorderProgram, ghost: GhostNodeProgram },
      labelColor: { color: GRAPH_PALETTE[stateRef.current.theme].labelOn },
      minCameraRatio: 0.02,
      maxCameraRatio: 12,
    });
    sigmaRef.current = sigma;

    sigma.setSetting("nodeReducer", (id, attr): Partial<NodeDisplayData> => {
      const s = stateRef.current;
      const n = nodeByIdRef.current.get(id);
      // A reducer must return a *complete* display-data object — Sigma uses it as-is, it isn't
      // merged with `attr` — so every branch below starts from `attr` (which carries x/y, set by
      // the structural-sync effect and kept live by the simulation's tick handler) rather than a
      // bare object literal, or Sigma throws "could not find a valid position" on the first paint.
      if (!n) return attr as Partial<NodeDisplayData>;
      const on = isLit(id, s.focus, s.hover, s.neighbors, s.searchIds);
      const baseColor = colorForType(n.type, s.types);
      const statusColor = colorForStatus(n.status);
      const isSelected = id === s.selected;
      const ringColor = isSelected ? "#fff" : statusColor;
      const displayColor = on ? baseColor : withAlpha(baseColor, 0.18);

      const res: Partial<NodeDisplayData> & { borderColor?: string } = {
        ...attr,
        label: n.label,
        size: nodeRadius(n) * (on ? 1.25 : 1),
        zIndex: on ? 2 : 1,
        forceLabel: isSelected || id === s.hover,
      };
      if (n.ghost) {
        res.type = "ghost";
        res.color = GRAPH_PALETTE[s.theme].background;
        res.borderColor = displayColor;
      } else if (ringColor) {
        res.type = "ring";
        res.color = displayColor;
        res.borderColor = on ? ringColor : withAlpha(ringColor, 0.18);
      } else {
        res.type = "circle";
        res.color = displayColor;
      }
      return res as Partial<NodeDisplayData>;
    });

    sigma.setSetting("edgeReducer", (edge, attr): Partial<EdgeDisplayData> => {
      const s = stateRef.current;
      const palette = GRAPH_PALETTE[s.theme];
      const ends = g.extremities(edge);
      const on = Boolean((s.focus || s.searchIds) && isLit(ends[0], s.focus, s.hover, s.neighbors, s.searchIds) && isLit(ends[1], s.focus, s.hover, s.neighbors, s.searchIds));
      const isTag = attr.kind === "tag";
      const color = isTag ? (on ? palette.tagLinkOn : palette.tagLinkOff) : on ? palette.linkOn : palette.linkOff;
      return { color, size: isTag ? (on ? 1.2 : 0.4) : on ? 1.5 : 0.5, zIndex: on ? 1 : 0 };
    });

    sigma.on("clickNode", ({ node }) => onSelectRef.current(node));
    sigma.on("enterNode", ({ node }) => setHover(node));
    sigma.on("leaveNode", () => setHover(null));

    return () => {
      sim.stop();
      sigma.kill();
      sigmaRef.current = null;
      graphRef.current = null;
      simRef.current = null;
    };
    // Mount-only — theme/hover/selection/search changes flow through stateRef + a manual
    // refresh() (below), not by tearing down and rebuilding the renderer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep stateRef current and repaint whenever anything the reducers read changes. Sigma only
  // redraws on its own triggers (graph mutation, camera move, explicit refresh) — plain prop
  // changes to these closures wouldn't otherwise cause a repaint.
  useEffect(() => {
    stateRef.current = { focus, hover, selected, searchIds, neighbors, types, theme };
    sigmaRef.current?.setSetting("labelColor", { color: GRAPH_PALETTE[theme].labelOn });
    sigmaRef.current?.refresh();
  }, [focus, hover, selected, searchIds, neighbors, types, theme]);

  // Obsidian-style hover: the hovered node repels its surroundings (neighbors drift outward), then
  // they ease back once the cursor leaves. The charge force itself already reads hoverRef live —
  // this effect's job is to reheat the simulation so the change is visible, and to pin the hovered
  // node's own x/y (fx/fy) so *it* doesn't also get pushed away by the neighbors it's repelling —
  // otherwise the node the cursor is on drifts out from under the pointer and becomes unclickable.
  useEffect(() => {
    hoverRef.current = hover;
    const prev = prevHoverRef.current;
    if (prev && prev !== hover) {
      const p = nodeByIdRef.current.get(prev);
      if (p) { p.fx = null; p.fy = null; }
    }
    if (hover) {
      const n = nodeByIdRef.current.get(hover);
      if (n) { n.fx = n.x; n.fy = n.y; }
    }
    prevHoverRef.current = hover;
    simRef.current?.alpha(0.3).restart();
  }, [hover]);

  // Structural sync: add/remove graphology nodes+edges and reseed the d3-force simulation
  // whenever the visible node/link set changes (filter toggles, tag-edge overlay, etc). Existing
  // nodes keep their current x/y (no relayout pop); only genuinely new nodes get a fresh seed.
  useEffect(() => {
    const g = graphRef.current;
    const sim = simRef.current;
    if (!g || !sim) return;

    const nodeById = new Map(data.nodes.map((n) => [n.id, n]));
    nodeByIdRef.current = nodeById;

    for (const id of g.nodes()) {
      if (!nodeById.has(id)) g.dropNode(id);
    }
    for (const n of data.nodes) {
      if (g.hasNode(n.id)) continue;
      if (n.x == null || n.y == null) {
        n.x = (Math.random() - 0.5) * 40;
        n.y = (Math.random() - 0.5) * 40;
      }
      g.addNode(n.id, { x: n.x, y: n.y, label: n.label });
    }

    const wantEdgeKeys = new Set<string>();
    for (const l of data.links) {
      const [a, b] = endpointIds(l);
      const key = `${l.kind}:${a}--${b}`;
      wantEdgeKeys.add(key);
      if (!g.hasEdge(key)) g.addEdgeWithKey(key, a, b, { kind: l.kind });
    }
    for (const key of g.edges()) {
      if (!wantEdgeKeys.has(key)) g.dropEdge(key);
    }

    sim.nodes(data.nodes);
    (sim.force("link") as ReturnType<typeof forceLink<GraphNode, GraphLink>>).links(data.links);
    sim.alpha(1).restart();
    sigmaRef.current?.refresh();
  }, [data]);

  // Neighbor-focus zoom-to-fit: frame the selected node + its direct neighbors (respecting the
  // tag-edge toggle via `neighbors`), whenever the selection changes — by click, or by arrow-key
  // cycling (App.tsx owns which node is "selected" for either reason). Reuses `fitTransform`
  // (lib/minimap.ts) for the scale math, same primitive the minimap fits its own view with.
  useEffect(() => {
    const sigma = sigmaRef.current;
    if (!sigma || !selected) return;
    const focusIds = neighbors.get(selected) ?? new Set<string>();
    const pts: { x: number; y: number }[] = [];
    for (const id of [selected, ...focusIds]) {
      const n = nodeByIdRef.current.get(id);
      if (n && n.x != null && n.y != null) pts.push({ x: n.x, y: n.y });
    }
    if (!pts.length) return;

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of pts) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
    }
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;

    const dims = sigma.getDimensions();
    const fit = fitTransform(pts, dims.width, dims.height, 80);
    if (!fit) return;

    const camera = sigma.getCamera();
    const cur = camera.getState();
    const desiredRatio = (cur.ratio * sigma.getGraphToViewportRatio()) / fit.scale;

    // Pan-to-point via a viewport round-trip: converts the target raw-graph point into Sigma's
    // internal "framed" camera-coordinate space without needing its private normalization
    // function — graphToViewport/viewportToFramedGraph are both public, documented conversions.
    const viewportPt = sigma.graphToViewport({ x: cx, y: cy });
    const framedPt = sigma.viewportToFramedGraph(viewportPt);
    camera.animate({ x: framedPt.x, y: framedPt.y, ratio: desiredRatio, angle: cur.angle }, { duration: 450 });
  }, [selected, neighbors]);

  return (
    <div className="graph" style={{ background: GRAPH_PALETTE[theme].background }}>
      {/* Sigma's kill() wipes every child of the element it's given (`while (container.firstChild)
          container.removeChild(...)`), so it needs an inner div it exclusively owns — sharing
          `.graph` directly with Minimap's sibling canvas would let a StrictMode dev remount (or
          any future teardown) silently delete Minimap's DOM node out from under React. */}
      <div ref={containerRef} style={{ position: "absolute", inset: 0 }} />
      <Minimap data={data} types={types} sigmaRef={sigmaRef} />
    </div>
  );
});

// Sigma's own canvases (edges/nodes/labels/hovers) are individually transparent — the dark/light
// background is CSS on the container div, not a canvas of Sigma's own, so getCanvases() never
// includes it. Fill the flattened output with the theme background first, or dark-theme content
// composites as near-invisible pale-on-white instead of matching what's on screen.
//
// The node/edge layers are WebGL canvases created with the (unconfigurable) default
// `preserveDrawingBuffer: false`, so their buffer is cleared once the browser presents a frame —
// reading them via drawImage() at an arbitrary later moment (a button click, not synced to
// Sigma's own render loop) can capture a blank canvas. `sigma.refresh()` with its default
// `schedule: false` renders synchronously (see Sigma#refresh: `if (schedule) ... else
// this.render()`), so calling it immediately beforehand guarantees a freshly-painted buffer for
// this same synchronous readback, before the browser gets a chance to clear it.
function exportSigmaPNG(sigma: Sigma | null, backgroundColor: string): string | null {
  if (!sigma) return null;
  sigma.refresh({ schedule: false });
  const canvases = sigma.getCanvases();
  const layers = Object.values(canvases);
  if (!layers.length) return null;

  const { width, height } = sigma.getDimensions();
  const out = document.createElement("canvas");
  out.width = width;
  out.height = height;
  const ctx = out.getContext("2d");
  if (!ctx) return null;

  ctx.fillStyle = backgroundColor;
  ctx.fillRect(0, 0, width, height);
  for (const layer of layers) {
    ctx.drawImage(layer, 0, 0, width, height);
  }
  return out.toDataURL("image/png");
}
