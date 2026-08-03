// @vitest-environment node
import { describe, it, expect } from "vitest";
import { fitTransform, clampedViewportRect, minimapToGraphCoords } from "./minimap";

describe("fitTransform", () => {
  it("returns null for an empty point set", () => {
    expect(fitTransform([], 180, 130, 10)).toBeNull();
  });

  it("maps a single point (zero-size bbox) somewhere inside the padded canvas", () => {
    const t = fitTransform([{ x: 5, y: 5 }], 180, 130, 10)!;
    expect(t.scale).toBeGreaterThan(0);
    const px = 5 * t.scale + t.offX;
    const py = 5 * t.scale + t.offY;
    expect(px).toBeGreaterThanOrEqual(10 - 0.01);
    expect(px).toBeLessThanOrEqual(170 + 0.01);
    expect(py).toBeGreaterThanOrEqual(10 - 0.01);
    expect(py).toBeLessThanOrEqual(120 + 0.01);
  });

  it("fits the bbox within the padded canvas without clipping", () => {
    const points = [{ x: -50, y: -20 }, { x: 50, y: 20 }];
    const t = fitTransform(points, 180, 130, 10)!;
    for (const p of points) {
      const px = p.x * t.scale + t.offX;
      const py = p.y * t.scale + t.offY;
      expect(px).toBeGreaterThanOrEqual(10 - 0.01);
      expect(px).toBeLessThanOrEqual(170 + 0.01);
      expect(py).toBeGreaterThanOrEqual(10 - 0.01);
      expect(py).toBeLessThanOrEqual(120 + 0.01);
    }
  });
});

describe("clampedViewportRect", () => {
  const transform = { scale: 1, offX: 0, offY: 0 };

  it("passes through a rect that's already within bounds", () => {
    const r = clampedViewportRect({ x: 20, y: 20 }, { x: 100, y: 80 }, transform, 180, 130);
    expect(r).toEqual({ x: 20, y: 20, width: 80, height: 60 });
  });

  it("clamps a rect that falls entirely outside the canvas to a zero-size rect at the edge", () => {
    const r = clampedViewportRect({ x: -500, y: -500 }, { x: -400, y: -400 }, transform, 180, 130);
    expect(r.x).toBe(0);
    expect(r.y).toBe(0);
    expect(r.width).toBe(0);
    expect(r.height).toBe(0);
  });

  it("clamps a rect that overhangs the canvas on one side", () => {
    const r = clampedViewportRect({ x: -50, y: -50 }, { x: 90, y: 60 }, transform, 180, 130);
    expect(r.x).toBe(0);
    expect(r.y).toBe(0);
    expect(r.width).toBe(90);
    expect(r.height).toBe(60);
  });
});

describe("minimapToGraphCoords", () => {
  it("is the inverse of the fitTransform mapping", () => {
    const transform = fitTransform([{ x: -50, y: -20 }, { x: 50, y: 20 }], 180, 130, 10)!;
    const graphPoint = { x: 12, y: -7 };
    const minimapX = graphPoint.x * transform.scale + transform.offX;
    const minimapY = graphPoint.y * transform.scale + transform.offY;
    const back = minimapToGraphCoords(minimapX, minimapY, transform);
    expect(back.x).toBeCloseTo(graphPoint.x, 5);
    expect(back.y).toBeCloseTo(graphPoint.y, 5);
  });
});
