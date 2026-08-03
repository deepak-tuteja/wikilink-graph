import { useEffect, useRef } from "react";
import type { GraphData } from "../lib/graph";
import { colorForType } from "../lib/graph";
import { fitTransform, clampedViewportRect, minimapToGraphCoords } from "../lib/minimap";

const WIDTH = 180;
const HEIGHT = 130;
const PADDING = 10;

interface Props {
  data: GraphData;
  types: string[];
  fgRef: React.MutableRefObject<any>;
}

// Overview canvas + viewport rectangle (#25). Redraws on a low-frequency timer rather than
// wiring onZoom/onEngineTick — node positions (mutated in place by d3-force) and the main
// canvas's pan/zoom transform both need polling anyway, and a 120ms tick is imperceptible for a
// wiki-sized graph while staying cheap.
export function Minimap({ data, types, fgRef }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Last-drawn graph<->minimap mapping, read back by the pan handlers below.
  const mapRef = useRef<{ scale: number; offX: number; offY: number } | null>(null);
  const draggingRef = useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const draw = () => {
      const nodes = data.nodes.filter((n) => n.x != null && n.y != null);
      ctx.clearRect(0, 0, WIDTH, HEIGHT);
      if (nodes.length === 0) return;

      const transform = fitTransform(
        nodes.map((n) => ({ x: n.x!, y: n.y! })),
        WIDTH,
        HEIGHT,
        PADDING
      )!;
      mapRef.current = transform;

      for (const n of nodes) {
        ctx.globalAlpha = n.ghost ? 0.4 : 0.85;
        ctx.fillStyle = colorForType(n.type, types);
        ctx.beginPath();
        ctx.arc(n.x! * transform.scale + transform.offX, n.y! * transform.scale + transform.offY, 1.6, 0, 2 * Math.PI);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      const fg = fgRef.current;
      const container = canvas.parentElement;
      if (fg && container) {
        const tl = fg.screen2GraphCoords(0, 0);
        const br = fg.screen2GraphCoords(container.clientWidth, container.clientHeight);
        const rect = clampedViewportRect(tl, br, transform, WIDTH, HEIGHT);
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 1;
        ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);
      }
    };

    draw();
    const id = window.setInterval(draw, 120);
    return () => window.clearInterval(id);
  }, [data, types, fgRef]);

  const panTo = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    const map = mapRef.current;
    const fg = fgRef.current;
    if (!canvas || !map || !fg) return;
    const rect = canvas.getBoundingClientRect();
    const { x: gx, y: gy } = minimapToGraphCoords(clientX - rect.left, clientY - rect.top, map);
    fg.centerAt(gx, gy, 0);
  };

  return (
    <canvas
      className="minimap"
      ref={canvasRef}
      width={WIDTH}
      height={HEIGHT}
      title="Minimap — click or drag to pan"
      onMouseDown={(e) => {
        draggingRef.current = true;
        panTo(e.clientX, e.clientY);
      }}
      onMouseMove={(e) => {
        if (draggingRef.current) panTo(e.clientX, e.clientY);
      }}
      onMouseUp={() => { draggingRef.current = false; }}
      onMouseLeave={() => { draggingRef.current = false; }}
    />
  );
}
