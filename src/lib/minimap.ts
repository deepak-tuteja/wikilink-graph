export interface MinimapTransform {
  scale: number;
  offX: number;
  offY: number;
}

// Fits a set of graph-space points into a width x height canvas with the given padding, centered.
// Returns null for an empty point set (nothing to fit).
export function fitTransform(
  points: { x: number; y: number }[],
  width: number,
  height: number,
  padding: number
): MinimapTransform | null {
  if (points.length === 0) return null;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  const w = Math.max(maxX - minX, 1);
  const h = Math.max(maxY - minY, 1);
  const scale = Math.min((width - padding * 2) / w, (height - padding * 2) / h);
  const offX = padding + (width - padding * 2 - w * scale) / 2 - minX * scale;
  const offY = padding + (height - padding * 2 - h * scale) / 2 - minY * scale;
  return { scale, offX, offY };
}

// Main view's viewport rect, mapped into minimap pixel space and clamped to the minimap's bounds
// — when zoomed out past the node bbox (e.g. on first load, before any click has zoomed in), the
// raw rect falls entirely outside the small minimap and would draw nothing; clamping makes that
// read as "the whole graph is in view" instead.
export function clampedViewportRect(
  topLeft: { x: number; y: number },
  bottomRight: { x: number; y: number },
  transform: MinimapTransform,
  width: number,
  height: number
): { x: number; y: number; width: number; height: number } {
  const rx1 = Math.max(0, Math.min(width, topLeft.x * transform.scale + transform.offX));
  const ry1 = Math.max(0, Math.min(height, topLeft.y * transform.scale + transform.offY));
  const rx2 = Math.max(0, Math.min(width, bottomRight.x * transform.scale + transform.offX));
  const ry2 = Math.max(0, Math.min(height, bottomRight.y * transform.scale + transform.offY));
  return { x: rx1, y: ry1, width: rx2 - rx1, height: ry2 - ry1 };
}

// Inverse of fitTransform: a minimap-local pixel coordinate (canvas-relative) -> graph coords,
// used to pan the main view when the minimap is clicked/dragged.
export function minimapToGraphCoords(
  x: number,
  y: number,
  transform: MinimapTransform
): { x: number; y: number } {
  return { x: (x - transform.offX) / transform.scale, y: (y - transform.offY) / transform.scale };
}
