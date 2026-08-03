import { useEffect, useRef } from "react";
import type { GraphData } from "../lib/graph";
import { colorForType } from "../lib/graph";

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

      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const n of nodes) {
        minX = Math.min(minX, n.x!); maxX = Math.max(maxX, n.x!);
        minY = Math.min(minY, n.y!); maxY = Math.max(maxY, n.y!);
      }
      const w = Math.max(maxX - minX, 1);
      const h = Math.max(maxY - minY, 1);
      const scale = Math.min((WIDTH - PADDING * 2) / w, (HEIGHT - PADDING * 2) / h);
      const offX = PADDING + (WIDTH - PADDING * 2 - w * scale) / 2 - minX * scale;
      const offY = PADDING + (HEIGHT - PADDING * 2 - h * scale) / 2 - minY * scale;
      mapRef.current = { scale, offX, offY };

      for (const n of nodes) {
        ctx.globalAlpha = n.ghost ? 0.4 : 0.85;
        ctx.fillStyle = colorForType(n.type, types);
        ctx.beginPath();
        ctx.arc(n.x! * scale + offX, n.y! * scale + offY, 1.6, 0, 2 * Math.PI);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      const fg = fgRef.current;
      const container = canvas.parentElement;
      if (fg && container) {
        const tl = fg.screen2GraphCoords(0, 0);
        const br = fg.screen2GraphCoords(container.clientWidth, container.clientHeight);
        // Clamp to the canvas: when zoomed out past the node bbox (e.g. on first load, before
        // any click has zoomed in), the raw rect falls entirely outside the small minimap and
        // would draw nothing — clamping makes that read as "the whole graph is in view" instead.
        const rx1 = Math.max(0, Math.min(WIDTH, tl.x * scale + offX));
        const ry1 = Math.max(0, Math.min(HEIGHT, tl.y * scale + offY));
        const rx2 = Math.max(0, Math.min(WIDTH, br.x * scale + offX));
        const ry2 = Math.max(0, Math.min(HEIGHT, br.y * scale + offY));
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 1;
        ctx.strokeRect(rx1, ry1, rx2 - rx1, ry2 - ry1);
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
    const gx = (clientX - rect.left - map.offX) / map.scale;
    const gy = (clientY - rect.top - map.offY) / map.scale;
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
