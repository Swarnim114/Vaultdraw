import { createBackgroundPattern } from "../data/backgroundPattern";

import { DOT_ROW_PHASES, renderBackgroundPattern } from "./backgroundPattern";

import type { BackgroundPatternView } from "./backgroundPattern";

const makeContext = () => {
  const calls: Record<string, number> = {};
  const count = (name: string) => () => {
    calls[name] = (calls[name] ?? 0) + 1;
  };
  const context: any = {
    calls,
    fillRects: [] as number[][],
    images: [] as { canvas: unknown; x: number; y: number }[],
    save: count("save"),
    restore: count("restore"),
    setTransform: count("setTransform"),
    beginPath: count("beginPath"),
    moveTo: count("moveTo"),
    lineTo: count("lineTo"),
    arc: count("arc"),
    stroke: count("stroke"),
    fill: count("fill"),
    fillRect: (...args: number[]) => {
      count("fillRect")();
      context.fillRects.push(args);
    },
    drawImage: (canvas: unknown, x: number, y: number) => {
      count("drawImage")();
      context.images.push({ canvas, x, y });
    },
  };
  return context;
};

/** Fake strip canvases (records each strip's dot centres), or none at all. */
const fakeStripCanvases = (withContext = true) => {
  const canvases: any[] = [];
  const spy = vi.spyOn(document, "createElement").mockImplementation(() => {
    const dots: number[][] = [];
    const canvas: any = {
      width: 0,
      height: 0,
      dots,
      getContext: () =>
        withContext
          ? {
              fillStyle: "",
              clearRect: () => dots.splice(0),
              beginPath: () => {},
              moveTo: () => {},
              arc: (x: number, y: number) => dots.push([x, y]),
              fill: () => {},
              drawImage: () => {},
            }
          : null,
    };
    canvases.push(canvas);
    return canvas;
  });
  return { canvases, restore: () => spy.mockRestore() };
};

/** The renderer caches strip canvases module-wide: load a fresh module. */
const freshRenderer = async () => {
  vi.resetModules();
  return (await import("./backgroundPattern")).renderBackgroundPattern;
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
  it("saves, resets the transform and restores", () => {
    const ctx = makeContext();
    renderBackgroundPattern(ctx, createBackgroundPattern("grid"), view());
    expect(ctx.calls.save).toBe(1);
    expect(ctx.calls.setTransform).toBe(1);
    expect(ctx.calls.restore).toBe(1);
  });

  it("grid: one whole-pixel rect per visible line, no strokes", () => {
    const ctx = makeContext();
    renderBackgroundPattern(
      ctx,
      { ...createBackgroundPattern("grid"), spacing: 20, majorEvery: 5 },
      view(),
    );
    expect(ctx.calls.stroke).toBeUndefined();
    // vertical minors: k=0..10 minus k%5==0 (0,5,10) = 8;
    // vertical majors x=0,100,200 = 3; horizontal minors k=0..5 minus 0,5 = 4;
    // horizontal majors k=0,5 = 2
    expect(ctx.calls.fillRect).toBe(8 + 3 + 4 + 2);
    for (const rect of ctx.fillRects) {
      expect(rect.every(Number.isInteger)).toBe(true);
    }
  });

  it("lines cover the pixels a centred, device-snapped stroke covers", () => {
    for (const scale of [1, 2, 3]) {
      const ctx = makeContext();
      renderBackgroundPattern(
        ctx,
        { ...createBackgroundPattern("lines"), marginLine: false },
        view({ scale, zoom: 1.37, scrollY: 3.3 }),
      );
      const lineWidth = Math.max(1, Math.round(scale));
      const center = lineWidth % 2 ? 0.5 : 0;
      ctx.fillRects.forEach(([x, y, w, h]: number[], i: number) => {
        const k = Math.ceil(-3.3 / 32) + i;
        const stroke =
          Math.round((k * 32 + 3.3) * 1.37 * scale - center) + center;
        expect([x, w, h]).toEqual([0, 200, lineWidth]);
        expect(y).toBe(stroke - lineWidth / 2);
      });
    }
  });

  it("LOD hides minor lines when zoomed out", () => {
    const ctx = makeContext();
    renderBackgroundPattern(
      ctx,
      { ...createBackgroundPattern("graph"), spacing: 10, majorEvery: 10 },
      view({ zoom: 0.5 }),
    );
    // minor gap 5px hidden; majors every 100 scene = 50px: x 0..400 -> 5,
    // y 0..200 -> 3
    expect(ctx.calls.fillRect).toBe(5 + 3);
  });

  it("lines: rules plus margin line", () => {
    const ctx = makeContext();
    renderBackgroundPattern(
      ctx,
      { ...createBackgroundPattern("lines"), spacing: 32 },
      view(),
    );
    // rules at y = 0, 32, 64, 96 and the margin at x = 80
    expect(ctx.calls.fillRect).toBe(5);
    expect(ctx.fillRects[4]).toEqual([80, 0, 1, 100]);
  });

  it("dots: one strip copy per row at a whole-pixel y, no per-dot work", async () => {
    const render = await freshRenderer();
    const fake = fakeStripCanvases();
    const ctx = makeContext();
    render(
      ctx,
      { ...createBackgroundPattern("dots"), spacing: 20 },
      view({ zoom: 1.37, scrollX: 3.1, scrollY: 2.9 }),
    );
    fake.restore();
    expect(ctx.calls.arc).toBeUndefined();
    expect(fake.canvases).toHaveLength(DOT_ROW_PHASES);
    // rows: gap 27.4 px over a 100 px tall view, plus one either side
    const firstRow = Math.ceil(-2.9 / 20) - 1;
    const lastRow = Math.floor((100 - 2.9 * 1.37) / 27.4) + 1;
    expect(ctx.calls.drawImage).toBe(lastRow - firstRow + 1);
    for (const image of ctx.images) {
      expect(image.x).toBe(0);
      expect(Number.isInteger(image.y)).toBe(true);
    }
    // each strip holds one row of dots at the exact columns' x
    const strip = fake.canvases[0];
    expect(strip.width).toBe(200);
    const xs = strip.dots.map(([x]: number[]) => x);
    for (const x of xs) {
      const k = Math.round((x - 3.1 * 1.37) / 27.4);
      expect(x).toBeCloseTo(3.1 * 1.37 + k * 27.4, 6);
    }
    expect(Math.min(...xs)).toBeLessThanOrEqual(0);
    expect(Math.max(...xs)).toBeGreaterThanOrEqual(200);
  });

  it("dots: each row is placed within half a phase of its exact y", async () => {
    const render = await freshRenderer();
    const fake = fakeStripCanvases();
    const ctx = makeContext();
    const zoom = 1.37;
    const scrollY = 2.9;
    render(
      ctx,
      { ...createBackgroundPattern("dots"), spacing: 20 },
      view({ zoom, scrollY }),
    );
    fake.restore();
    const firstRow = Math.ceil(-scrollY / 20) - 1;
    ctx.images.forEach(
      ({ canvas, y }: { canvas: any; y: number }, i: number) => {
        const exact = (scrollY + (firstRow + i) * 20) * zoom;
        const drawn = y + canvas.dots[0][1];
        expect(Math.abs(drawn - exact)).toBeLessThanOrEqual(
          0.5 / DOT_ROW_PHASES + 1e-9,
        );
      },
    );
  });

  it("dots: strips are reused on a vertical pan and redrawn on zoom", async () => {
    const render = await freshRenderer();
    const fake = fakeStripCanvases();
    const ctx = makeContext();
    const dots = { ...createBackgroundPattern("dots"), spacing: 20 };
    render(ctx, dots, view({ zoom: 1.37 }));
    const built = fake.canvases[0].dots.slice();
    fake.canvases[0].dots.length = 0;
    render(ctx, dots, view({ zoom: 1.37, scrollY: -41.7 }));
    expect(fake.canvases[0].dots).toHaveLength(0); // not redrawn
    render(ctx, dots, view({ zoom: 1.4 }));
    fake.restore();
    expect(fake.canvases).toHaveLength(DOT_ROW_PHASES); // canvases reused
    expect(fake.canvases[0].dots.length).toBeGreaterThan(0);
    expect(fake.canvases[0].dots).not.toEqual(built);
  });

  it("dots: a whole-pixel gap puts dots where the old tile did", async () => {
    const render = await freshRenderer();
    const fake = fakeStripCanvases();
    const ctx = makeContext();
    render(
      ctx,
      { ...createBackgroundPattern("dots"), spacing: 20 },
      view({ scrollX: 13.25, scrollY: -7.5 }),
    );
    fake.restore();
    // tile offset round(mod(13.25 - 10, 20)) = 3, dot at its centre: x = 13
    const xs = fake.canvases[0].dots.map(([x]: number[]) => x);
    expect(xs).toContain(13);
    // y: round(mod(-7.5 - 10, 20)) = 3 (2.5 rounds up), dot at 13
    const ys = ctx.images.map(
      ({ canvas, y }: { canvas: any; y: number }) => y + canvas.dots[0][1],
    );
    expect(ys).toContain(13);
  });

  it("isometric: odd rows use strips shifted by half a gap", async () => {
    const render = await freshRenderer();
    const fake = fakeStripCanvases();
    const ctx = makeContext();
    render(
      ctx,
      { ...createBackgroundPattern("isometric"), spacing: 30 },
      // a large view: no dot cap on the strip path
      view({ width: 6000, height: 6000 }),
    );
    fake.restore();
    expect(fake.canvases).toHaveLength(DOT_ROW_PHASES * 2);
    const even = fake.canvases[0].dots[1][0];
    const odd = fake.canvases[DOT_ROW_PHASES].dots[1][0];
    expect(Math.abs(odd - even)).toBeCloseTo(15, 6);
    // rows sqrt(3)/2 * 30 apart over 6000 px, alternating even/odd strips
    expect(ctx.calls.drawImage).toBeGreaterThan(6000 / 26);
    const evenStrips = fake.canvases.slice(0, DOT_ROW_PHASES);
    const kinds = ctx.images.map((image: any) =>
      evenStrips.includes(image.canvas),
    );
    expect(
      kinds.every((k: boolean, i: number) => i === 0 || k !== kinds[i - 1]),
    ).toBe(true);
  });

  it("falls back to one dot path without a canvas for strips", async () => {
    const render = await freshRenderer();
    const fake = fakeStripCanvases(false);
    const ctx = makeContext();
    render(ctx, { ...createBackgroundPattern("dots"), spacing: 50 }, view());
    fake.restore();
    expect(ctx.calls.fill).toBe(1);
    expect(ctx.calls.arc).toBeGreaterThan(0);
    expect(ctx.calls.drawImage).toBeUndefined();
  });

  it("draws nothing for dots below the LOD threshold", () => {
    const ctx = makeContext();
    renderBackgroundPattern(
      ctx,
      { ...createBackgroundPattern("dots"), spacing: 20 },
      view({ zoom: 0.3 }),
    );
    expect(ctx.calls.drawImage).toBeUndefined();
    expect(ctx.calls.fill).toBeUndefined();
  });
});
