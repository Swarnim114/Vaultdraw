import { DEFAULT_PAGE_SETUP, getPagePitch } from "../data/pageSetup";

import {
  PAGE_SURROUND_DARK,
  PAGE_SURROUND_LIGHT,
  renderPageSurround,
} from "./pageFrame";

import type { PageSetup } from "../data/pageSetup";
import type { PageFrameView } from "./pageFrame";

const makeContext = () => {
  const ops: any[] = [];
  const context: any = {
    ops,
    fillStyle: "",
    fills: [] as { style: string; rect: number[] }[],
    rects: [] as number[][],
    save: () => ops.push("save"),
    restore: () => ops.push("restore"),
    setTransform: () => ops.push("setTransform"),
    beginPath: () => ops.push("beginPath"),
    clip: () => ops.push("clip"),
    rect: (...a: number[]) => context.rects.push(a),
    fillRect: (...a: number[]) =>
      context.fills.push({ style: context.fillStyle, rect: a }),
  };
  return context;
};

const view = (over: Partial<PageFrameView> = {}): PageFrameView => ({
  scrollX: 100,
  scrollY: 20,
  zoom: 1,
  scale: 1,
  width: 1200,
  height: 800,
  isDarkMode: false,
  ...over,
});

const setup = (over: Partial<PageSetup> = {}): PageSetup => ({
  ...DEFAULT_PAGE_SETUP,
  pageCount: 5,
  ...over,
});

const surroundFills = (c: any, dark = false) =>
  c.fills.filter(
    (f: any) => f.style === (dark ? PAGE_SURROUND_DARK : PAGE_SURROUND_LIGHT),
  );
const area = (fills: any[]) =>
  fills.reduce((a: number, f: any) => a + f.rect[2] * f.rect[3], 0);
const overlaps = (r: number[], x: number, y: number) =>
  x >= r[0] && x < r[0] + r[2] && y >= r[1] && y < r[1] + r[3];

describe("renderPageSurround", () => {
  it("separate: surround is exactly the complement of the visible pages", () => {
    const s = setup();
    const pitch = getPagePitch(s);
    const c = makeContext();
    renderPageSurround(c, s, view({ scrollY: 0, height: 1200 }));
    const fills = surroundFills(c);
    const pageArea = s.width * s.height + s.width * (1200 - pitch);
    expect(area(fills)).toBe(1200 * 1200 - pageArea);
    const inside = (x: number, y: number) =>
      fills.some((f: any) => overlaps(f.rect, x, y));
    expect(inside(110, 10)).toBe(false);
    expect(inside(110, pitch + 10)).toBe(false);
    expect(inside(110, s.height + 5)).toBe(true);
    expect(inside(50, 10)).toBe(true);
    expect(inside(100 + s.width + 50, 10)).toBe(true);
    for (let i = 0; i < fills.length; i++) {
      for (let j = i + 1; j < fills.length; j++) {
        const a = fills[i].rect;
        const b = fills[j].rect;
        const hit =
          a[0] < b[0] + b[2] &&
          b[0] < a[0] + a[2] &&
          a[1] < b[1] + b[3] &&
          b[1] < a[1] + a[3];
        expect(hit).toBe(false);
      }
    }
  });

  it("continuous: complement of the one sheet, with a break line", () => {
    const s = setup({ layout: "continuous" });
    const c = makeContext();
    renderPageSurround(c, s, view({ scrollY: 0, height: 2000 }));
    expect(area(surroundFills(c))).toBe(1200 * 2000 - s.width * 2000);
    const breaks = c.fills.filter((f: any) => f.rect[3] === 1);
    expect(breaks.some((f: any) => f.rect[1] === s.height)).toBe(true);
  });

  it("page top on screen: strip above the first page", () => {
    const c = makeContext();
    renderPageSurround(c, setup(), view({ scrollY: 50, height: 400 }));
    const fills = surroundFills(c);
    expect(fills.some((f: any) => overlaps(f.rect, 300, 20))).toBe(true);
    expect(fills.some((f: any) => overlaps(f.rect, 300, 60))).toBe(false);
  });

  it("uses the dark surround colour in dark mode", () => {
    const c = makeContext();
    renderPageSurround(c, setup(), view({ isDarkMode: true }));
    expect(surroundFills(c, true).length).toBeGreaterThan(0);
    expect(surroundFills(c, false)).toHaveLength(0);
  });

  it("zoomed in past the page edges: no side strips", () => {
    const c = makeContext();
    renderPageSurround(
      c,
      setup(),
      view({ scrollX: -50, zoom: 4, width: 1000, height: 600 }),
    );
    expect(
      surroundFills(c).every((f: any) => f.rect[0] === 0 && f.rect[2] === 1000),
    ).toBe(true);
  });

  it("no page visible: one full surround fill", () => {
    const c = makeContext();
    renderPageSurround(c, setup(), view({ scrollY: 5000 }));
    expect(c.fills).toEqual([
      { style: PAGE_SURROUND_LIGHT, rect: [0, 0, 1200, 800] },
    ]);
  });

  it("never clips, no shadowBlur, bounded number of draws", () => {
    const c = makeContext();
    renderPageSurround(c, setup({ pageCount: 500 }), view({ height: 4000 }));
    expect(c.ops).not.toContain("clip");
    expect(c.ops).not.toContain("beginPath");
    expect(c.shadowBlur).toBeUndefined();
    expect(c.fills.length).toBeLessThan(60);
  });

  it("shadows never paint over the next page when the gap is tiny", () => {
    const s = setup();
    const c = makeContext();
    renderPageSurround(c, s, view({ scrollY: 0, scrollX: 0, zoom: 0.1 }));
    const nextTop = Math.round(getPagePitch(s) * 0.1);
    for (const f of c.fills) {
      if (f.style.startsWith("rgba(0,0,0,0.0")) {
        const [, y, , h] = f.rect;
        expect(y + h <= nextTop || y >= nextTop).toBe(true);
      }
    }
  });

  it("snaps edges to device pixels", () => {
    const c = makeContext();
    renderPageSurround(
      c,
      setup({ layout: "continuous" }),
      view({
        scrollX: 10.3,
        scrollY: 0,
        zoom: 0.77,
        scale: 2,
        width: 3000,
        height: 2000,
      }),
    );
    expect(c.fills[0].rect[2]).toBe(Math.round(10.3 * 0.77 * 2));
    expect(c.fills.every((f: any) => f.rect.every(Number.isInteger))).toBe(
      true,
    );
  });

  it("costs microseconds per frame (recording context)", () => {
    const noop = () => {};
    const c: any = {
      fillStyle: "",
      save: noop,
      restore: noop,
      setTransform: noop,
      fillRect: noop,
    };
    const s = setup({ pageCount: 50 });
    const n = 20000;
    const t0 = performance.now();
    for (let i = 0; i < n; i++) {
      renderPageSurround(c, s, view({ scrollY: -i }));
    }
    expect((performance.now() - t0) / n).toBeLessThan(0.1);
  });
});
