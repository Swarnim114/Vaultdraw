import { createBackgroundPattern } from "../data/backgroundPattern";

import { renderBackgroundPattern } from "./backgroundPattern";

import type { BackgroundPatternView } from "./backgroundPattern";

const makeContext = (withPattern = true) => {
  const calls: Record<string, number> = {};
  const count = (name: string) => () => {
    calls[name] = (calls[name] ?? 0) + 1;
  };
  const pattern = { setTransform: vi.fn() };
  const context: any = {
    calls,
    pattern,
    save: count("save"),
    restore: count("restore"),
    setTransform: count("setTransform"),
    beginPath: count("beginPath"),
    moveTo: count("moveTo"),
    lineTo: count("lineTo"),
    arc: count("arc"),
    stroke: count("stroke"),
    fill: count("fill"),
    fillRect: count("fillRect"),
    createPattern: withPattern
      ? () => {
          calls.createPattern = (calls.createPattern ?? 0) + 1;
          return pattern;
        }
      : undefined,
  };
  return context;
};

const view = (over: Partial<BackgroundPatternView> = {}) => ({
  scrollX: 0,
  scrollY: 0,
  zoom: 1,
  scale: 1,
  width: 200,
  height: 100,
  isDarkMode: false,
  ...over,
});

describe("renderBackgroundPattern", () => {
  beforeAll(() => {
    if (typeof DOMMatrix === "undefined") {
      vi.stubGlobal("DOMMatrix", class {});
    }
  });

  it("saves, resets the transform and restores", () => {
    const ctx = makeContext();
    renderBackgroundPattern(ctx, createBackgroundPattern("grid"), view());
    expect(ctx.calls.save).toBe(1);
    expect(ctx.calls.setTransform).toBe(1);
    expect(ctx.calls.restore).toBe(1);
  });

  it("grid: one stroke per level and only visible lines", () => {
    const ctx = makeContext();
    renderBackgroundPattern(
      ctx,
      { ...createBackgroundPattern("grid"), spacing: 20, majorEvery: 5 },
      view(),
    );
    expect(ctx.calls.stroke).toBe(4);
    // vertical minors: k=0..10 minus k%5==0 (0,5,10) = 8;
    // vertical majors x=0,100,200 = 3; horizontal minors k=0..5 minus 0,5 = 4;
    // horizontal majors k=0,5 = 2
    expect(ctx.calls.moveTo).toBe(8 + 3 + 4 + 2);
  });

  it("LOD hides minor lines when zoomed out", () => {
    const ctx = makeContext();
    renderBackgroundPattern(
      ctx,
      { ...createBackgroundPattern("graph"), spacing: 10, majorEvery: 10 },
      view({ zoom: 0.5 }),
    );
    // minor gap 5px hidden, major gap 50px visible: 1 stroke per axis
    expect(ctx.calls.stroke).toBe(2);
  });

  it("never draws more than 3 strokes per axis pair", () => {
    const ctx = makeContext();
    renderBackgroundPattern(ctx, createBackgroundPattern("graph"), view());
    expect(ctx.calls.stroke).toBeLessThanOrEqual(4);
  });

  it("lines: rules plus margin line", () => {
    const ctx = makeContext();
    renderBackgroundPattern(
      ctx,
      { ...createBackgroundPattern("lines"), spacing: 32 },
      view(),
    );
    expect(ctx.calls.stroke).toBe(2);
  });

  it("dots: reuses the tile pattern on pure pan", () => {
    const ctx = makeContext();
    const dots = { ...createBackgroundPattern("dots"), spacing: 21 };
    renderBackgroundPattern(ctx, dots, view());
    renderBackgroundPattern(ctx, dots, view({ scrollX: -33, scrollY: 17 }));
    expect(ctx.calls.createPattern).toBe(1);
    expect(ctx.calls.fillRect).toBe(2);
    expect(ctx.pattern.setTransform).toHaveBeenCalledTimes(2);
    // zoom change rebuilds
    renderBackgroundPattern(ctx, dots, view({ zoom: 1.5 }));
    expect(ctx.calls.createPattern).toBe(2);
  });

  it("isometric: tile is one cell wide and two rows tall", async () => {
    // the tile canvas is cached module-wide: load a fresh module
    vi.resetModules();
    const fresh = await import("./backgroundPattern");
    const ctx = makeContext();
    const tileCanvas: any = {
      getContext: () => ({
        fillStyle: "",
        beginPath: () => {},
        arc: vi.fn(),
        moveTo: () => {},
        fill: () => {},
      }),
    };
    const spy = vi.spyOn(document, "createElement").mockReturnValue(tileCanvas);
    fresh.renderBackgroundPattern(
      ctx,
      { ...createBackgroundPattern("isometric"), spacing: 30 },
      view(),
    );
    spy.mockRestore();
    expect(ctx.calls.createPattern).toBe(1);
    expect(tileCanvas.width).toBe(30);
    expect(tileCanvas.height).toBe(Math.round(30 * Math.sqrt(3)));
  });

  it("falls back to one dot path without createPattern", () => {
    const ctx = makeContext(false);
    renderBackgroundPattern(
      ctx,
      { ...createBackgroundPattern("dots"), spacing: 50 },
      view(),
    );
    expect(ctx.calls.fill).toBe(1);
    expect(ctx.calls.arc).toBeGreaterThan(0);
    expect(ctx.calls.fillRect).toBeUndefined();
  });

  it("draws nothing for dots below the LOD threshold", () => {
    const ctx = makeContext();
    renderBackgroundPattern(
      ctx,
      { ...createBackgroundPattern("dots"), spacing: 20 },
      view({ zoom: 0.3 }),
    );
    expect(ctx.calls.fillRect).toBeUndefined();
    expect(ctx.calls.fill).toBeUndefined();
  });
});
