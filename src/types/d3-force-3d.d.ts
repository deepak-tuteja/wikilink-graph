// d3-force-3d ships no type declarations (checked node_modules/d3-force-3d — .js source only,
// no .d.ts in dist/ or the package root). Minimal shim for the exports this build uses.
declare module "d3-force-3d" {
  export interface Force3D {
    (alpha: number): void;
    initialize?: (nodes: unknown[], ...args: unknown[]) => void;
    strength(value: number): Force3D;
    radius(value: number): Force3D;
    x(value: number): Force3D;
    y(value: number): Force3D;
    z(value: number): Force3D;
  }

  export function forceRadial(radius: number, x?: number, y?: number, z?: number): Force3D;
  // Live visual eval follow-up #4 (2026-08-06, Graph3D.tsx) — recentering-force fix for the
  // crescent/one-sided-cap bug.
  export function forceCenter(x?: number, y?: number, z?: number): Force3D;
  export function forceManyBody(): Force3D;
}
