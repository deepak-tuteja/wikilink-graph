import { useCallback, useEffect, useRef, useState } from "react";
import ForceGraph2D from "react-force-graph-2d";
import type { GraphData, GraphNode } from "../lib/graph";
import { colorForType, colorForStatus, nodeRadius, endpointIds, forceCluster } from "../lib/graph";
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

export function Graph({ data, types, neighbors, selected, searchIds, theme, onSelect }: Props) {
  const fgRef = useRef<any>(null);
  const [hover, setHover] = useState<string | null>(null);
  const palette = GRAPH_PALETTE[theme];

  // Obsidian-style hover: the hovered node repels its surroundings (neighbors
  // drift outward), then they ease back once the cursor leaves.
  useEffect(() => {
    const charge = fgRef.current?.d3Force("charge");
    if (!charge) return;
    charge.strength((n: GraphNode) => (n.id === hover ? -90 : -30));
    fgRef.current?.d3ReheatSimulation();
  }, [hover]);

  // Type-based clustering: a gentle custom force nudging same-type nodes toward their shared
  // centroid, so the graph reads as clusters-of-a-type instead of one undifferentiated blob —
  // most useful once the (uncapped) tag-edge overlay is on.
  useEffect(() => {
    fgRef.current?.d3Force("cluster", forceCluster());
    fgRef.current?.d3ReheatSimulation();
  }, [data]);

  // Neighbor-focus zoom-to-fit: frame the selected node + its direct neighbors (respecting the
  // tag-edge toggle via `neighbors`), whenever the selection changes — by click, or by arrow-key
  // cycling (App.tsx owns which node is "selected" for either reason).
  useEffect(() => {
    if (!selected) return;
    const focusIds = neighbors.get(selected) ?? new Set<string>();
    fgRef.current?.zoomToFit(450, 80, (node: GraphNode) => node.id === selected || focusIds.has(node.id));
  }, [selected, neighbors]);

  const focus = hover ?? selected;
  const lit = useCallback(
    (id: string) => {
      // search takes precedence: only matches stay lit (plus a hovered node + neighbors)
      if (searchIds) {
        if (hover) return id === hover || (neighbors.get(hover)?.has(id) ?? false);
        return searchIds.has(id);
      }
      return !focus || id === focus || (neighbors.get(focus)?.has(id) ?? false);
    },
    [focus, hover, neighbors, searchIds]
  );

  const paintNode = useCallback(
    (node: GraphNode, ctx: CanvasRenderingContext2D, scale: number) => {
      const r = nodeRadius(node);
      const on = lit(node.id);
      const color = colorForType(node.type, types);

      ctx.globalAlpha = on ? 1 : 0.15;
      // Glow: a soft shadow-blur behind lit nodes only — cosmetic, and skipped for dimmed nodes
      // so it doesn't wash out the "everything but the focus is faded" effect.
      if (on && !node.ghost) {
        ctx.shadowColor = color;
        ctx.shadowBlur = 8 / scale;
      }
      ctx.beginPath();
      ctx.arc(node.x!, node.y!, r, 0, 2 * Math.PI);
      if (node.ghost) {
        ctx.setLineDash([2, 2]);
        ctx.strokeStyle = color;
        ctx.lineWidth = 1 / scale;
        ctx.stroke();
        ctx.setLineDash([]);
      } else {
        ctx.fillStyle = color;
        ctx.fill();
      }
      ctx.shadowBlur = 0;
      const statusColor = colorForStatus(node.status);
      if (statusColor) {
        ctx.beginPath();
        ctx.arc(node.x!, node.y!, r + 2.5 / scale, 0, 2 * Math.PI);
        ctx.lineWidth = 1.5 / scale;
        ctx.strokeStyle = statusColor;
        ctx.stroke();
      }

      if (node.id === selected) {
        ctx.lineWidth = 2 / scale;
        ctx.strokeStyle = "#fff";
        ctx.stroke();
      }

      const fontSize = Math.max(10 / scale, 2.5);
      ctx.font = `${fontSize}px sans-serif`;
      ctx.fillStyle = on ? palette.labelOn : palette.labelOff;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillText(node.label, node.x!, node.y! + r + 1);
      ctx.globalAlpha = 1;
    },
    [lit, types, selected, palette]
  );

  return (
    <div className="graph">
      <ForceGraph2D
        ref={fgRef}
        graphData={data}
        backgroundColor={palette.background}
        maxZoom={6}
        nodeId="id"
        nodeCanvasObject={paintNode}
        nodePointerAreaPaint={(node: GraphNode, color: string, ctx: CanvasRenderingContext2D) => {
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.arc(node.x!, node.y!, nodeRadius(node) + 2, 0, 2 * Math.PI);
          ctx.fill();
        }}
        linkColor={(l: any) => {
          const [a, b] = endpointIds(l);
          const on = (focus || searchIds) && lit(a) && lit(b);
          if (l.kind === "tag") return on ? palette.tagLinkOn : palette.tagLinkOff;
          return on ? palette.linkOn : palette.linkOff;
        }}
        linkWidth={(l: any) => {
          const [a, b] = endpointIds(l);
          const on = (focus || searchIds) && lit(a) && lit(b);
          if (l.kind === "tag") return on ? 1.2 : 0.4;
          return on ? 1.5 : 0.5;
        }}
        linkLineDash={(l: any) => (l.kind === "tag" ? [2, 2] : null)}
        onNodeHover={(n: GraphNode | null) => setHover(n?.id ?? null)}
        onNodeClick={(n: GraphNode) => onSelect(n.id)}
        cooldownTicks={120}
      />
      <Minimap data={data} types={types} fgRef={fgRef} />
    </div>
  );
}
