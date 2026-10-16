import { describe, expect, it } from "vitest";

import { Camera, computeBounds, easeOutCubic, fitCamera } from "./camera";

describe("camera maths", () => {
  it("screen <-> world round trips", () => {
    const c = new Camera();
    c.setViewport(800, 600);
    c.set({ x: 120, y: -40, scale: 0.7 });
    const s = c.worldToScreen(33, 77);
    const w = c.screenToWorld(s.x, s.y);
    expect(w.x).toBeCloseTo(33, 6);
    expect(w.y).toBeCloseTo(77, 6);
    expect(c.worldToScreen(120, -40)).toEqual({ x: 400, y: 300 });
  });

  it("zoomAt keeps the world point under the pointer fixed", () => {
    const c = new Camera();
    c.setViewport(1000, 700);
    c.set({ x: 10, y: 20, scale: 1 });
    const before = c.screenToWorld(250, 180);
    c.zoomAt(250, 180, 2.5);
    const after = c.screenToWorld(250, 180);
    expect(c.scale).toBeCloseTo(2.5, 9);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
  });

  it("clamps scale and (optionally) the centre", () => {
    const c = new Camera();
    c.minScale = 0.1;
    c.maxScale = 4;
    c.zoomAt(0, 0, 1000);
    expect(c.scale).toBe(4);
    c.zoomAt(0, 0, 1e-9);
    expect(c.scale).toBe(0.1);
    c.limits = { minX: -10, minY: -10, maxX: 10, maxY: 10 };
    c.panBy(-1e6, 1e6);
    expect(c.x).toBe(10);
    expect(c.y).toBe(-10);
  });

  it("panBy moves by screen px / scale", () => {
    const c = new Camera();
    c.set({ x: 0, y: 0, scale: 2 });
    c.panBy(20, -10);
    expect(c.x).toBe(-10);
    expect(c.y).toBe(5);
  });

  it("fitCamera centres and respects padding / max scale", () => {
    const f = fitCamera({ minX: 0, minY: 0, maxX: 1000, maxY: 500 }, { w: 1000, h: 700 }, 50);
    expect(f.x).toBe(500);
    expect(f.y).toBe(250);
    expect(f.scale).toBeCloseTo(0.9, 9);
    const tiny = fitCamera({ minX: 0, minY: 0, maxX: 1, maxY: 1 }, { w: 1000, h: 700 }, 50);
    expect(tiny.scale).toBe(2);
    const point = fitCamera({ minX: 5, minY: 5, maxX: 5, maxY: 5 }, { w: 100, h: 100 });
    expect(Number.isFinite(point.scale)).toBe(true);
  });

  it("computeBounds skips hidden nodes and empty sets", () => {
    const p = new Float32Array([0, 0, 10, 20, -5, 3]);
    expect(computeBounds(p, 3)).toEqual({ minX: -5, minY: 0, maxX: 10, maxY: 20 });
    expect(computeBounds(p, 3, new Uint8Array([0, 1, 0]))).toEqual({
      minX: -5, minY: 0, maxX: 0, maxY: 3,
    });
    expect(computeBounds(p, 0)).toBeNull();
  });

  it("tween: 200 ms ease-out, ends exactly on target, step is false when idle", () => {
    const c = new Camera();
    c.setViewport(100, 100);
    expect(c.step(0)).toBe(false);
    c.set({ x: 0, y: 0, scale: 1 });
    c.animateTo({ x: 100, y: 50, scale: 4 }, 1000);
    expect(c.step(1000 + 100)).toBe(true);
    // ease-out: past halfway at half the time
    expect(c.x).toBeGreaterThan(50);
    expect(c.scale).toBeGreaterThan(1);
    expect(c.step(1000 + 200)).toBe(false);
    expect(c).toMatchObject({ x: 100, y: 50, scale: 4 });
    expect(c.isAnimating).toBe(false);
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
  });

  it("user input cancels a running tween", () => {
    const c = new Camera();
    c.animateTo({ x: 9, y: 9, scale: 2 }, 0);
    expect(c.isAnimating).toBe(true);
    c.panBy(1, 1);
    expect(c.isAnimating).toBe(false);
  });
});
