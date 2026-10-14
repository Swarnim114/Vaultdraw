import { DEFAULT_PAGE_SETUP, getPagePitch } from "../data/pageSetup";

import {
  PAGE_SURROUND_DARK,
  PAGE_SURROUND_LIGHT,
  renderPageFrame,
  withPageClip,
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

const PAPER = "#fff";
const paperFills = (c: any) => c.fills.filter((f: any) => f.style === PAPER);

describe("renderPageFrame", () => {
  it("fills the surround by theme, never through the paper colour", () => {
    for (const [dark, color] of [
      [false, PAGE_SURROUND_LIGHT],
      [true, PAGE_SURROUND_DARK],
    ] as const) {
      const c = makeContext();
      renderPageFrame(c, setup(), view({ isDarkMode: dark }), { paper: PAPER });
      expect(c.fills[0]).toEqual({ style: color, rect: [0, 0, 1200, 800] });
    }
  });

  it("separate: draws only visible pages, gaps stay surround", () => {
    const s = setup();
    const pitch = getPagePitch(s);
    const c = makeContext();
    // view covers page 0 and part of page 1 (page 1 starts at pitch)
    const clip = renderPageFrame(c, s, view({ scrollY: 0, height: 1200 }), {
      paper: PAPER,
    });
    expect(clip).toEqual([
      100,
      0,
      100 + s.width,
      s.height,
      100,
      pitch,
      100 + s.width,
      pitch + s.height > 1200 ? 1204 : pitch + s.height,
    ]);
    expect(paperFills(c)).toHaveLength(2);
    // the gap rows between pages are not covered by any paper fill
    const gapY = s.height + 10;
    expect(
      paperFills(c).some(
        (f: any) => f.rect[1] <= gapY && f.rect[1] + f.rect[3] > gapY,
      ),
    ).toBe(false);
  });

  it("separate: skips pages scrolled out of view", () => {
    const s = setup();
    const pitch = getPagePitch(s);
    const c = makeContext();
    const clip = renderPageFrame(
      c,
      s,
      view({ scrollY: -(pitch * 3), height: 600 }),
      {
        paper: PAPER,
      },
    )!;
    expect(clip).toHaveLength(4);
    expect(paperFills(c)).toHaveLength(1);
  });

  it("continuous: one sheet and break lines at page splits", () => {
    const s = setup({ layout: "continuous" });
    const c = makeContext();
    const clip = renderPageFrame(c, s, view({ scrollY: 0, height: 2000 }), {
      paper: PAPER,
    })!;
    expect(clip).toHaveLength(4);
    expect(paperFills(c)).toHaveLength(1);
    // breaks at 1123 (1x) and the sheet end is clamped, one line per break
    const breaks = c.fills.filter((f: any) => f.rect[3] === 1);
    expect(breaks).toHaveLength(1);
    expect(breaks[0].rect[1]).toBe(s.height);
  });

  it("returns an empty clip (and still the surround) when no page is visible", () => {
    const c = makeContext();
    const clip = renderPageFrame(c, setup(), view({ scrollY: 5000 }), {
      paper: PAPER,
    });
    expect(clip).toEqual([]);
    expect(c.fills).toHaveLength(1);
  });

  it("snaps edges to device pixels and scales borders", () => {
    const c = makeContext();
    const clip = renderPageFrame(
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
      { paper: PAPER },
    )!;
    expect(clip[0]).toBe(Math.round(10.3 * 0.77 * 2));
    expect(Number.isInteger(clip[2])).toBe(true);
  });

  it("uses no shadowBlur and a bounded number of draws", () => {
    const c = makeContext();
    renderPageFrame(c, setup({ pageCount: 500 }), view({ height: 4000 }), {
      paper: PAPER,
    });
    expect(c.shadowBlur).toBeUndefined();
    expect(c.fills.length).toBeLessThan(30);
  });
});

describe("withPageClip", () => {
  it("draws directly when there is no clip (page mode off)", () => {
    const c = makeContext();
    const draw = vi.fn();
    withPageClip(c, null, draw);
    expect(draw).toHaveBeenCalledTimes(1);
    expect(c.ops).toEqual([]);
  });

  it("clips to all page rects once, then restores", () => {
    const c = makeContext();
    const draw = vi.fn(() => c.ops.push("draw"));
    withPageClip(c, [1, 2, 11, 22, 1, 40, 11, 60], draw);
    expect(c.rects).toEqual([
      [1, 2, 10, 20],
      [1, 40, 10, 20],
    ]);
    expect(c.ops).toEqual([
      "save",
      "setTransform",
      "beginPath",
      "clip",
      "draw",
      "restore",
    ]);
  });
});

describe("renderPageFrame call overhead (recording context, no real canvas)", () => {
  it("costs microseconds per frame", () => {
    const noop = () => {};
    const c: any = {
      fillStyle: "",
      save: noop,
      restore: noop,
      setTransform: noop,
      beginPath: noop,
      clip: noop,
      rect: noop,
      fillRect: noop,
    };
    const s = setup({ pageCount: 50 });
    const colors = { paper: "#fff" };
    const n = 20000;
    const t0 = performance.now();
    for (let i = 0; i < n; i++) {
      const clip = renderPageFrame(c, s, view({ scrollY: -i }), colors);
      withPageClip(c, clip, noop);
    }
    const perFrameMs = (performance.now() - t0) / n;
    // eslint-disable-next-line no-console
    console.info(
      `pageFrame JS cost: ${(perFrameMs * 1000).toFixed(2)} us/frame`,
    );
    expect(perFrameMs).toBeLessThan(0.1);
  });
});
