import {
  PAGE_GAP,
  getPageSizeInPoints,
  updatePageSetup,
} from "@excalidraw/excalidraw/data/pageSetup";
import { describe, expect, it } from "vitest";

import { clampRenderScale, planPdfPages } from "./pdfPages";

const el = (x: number, y: number, width: number, height: number, extra = {}) =>
  ({
    id: `${x}-${y}`,
    type: "rectangle",
    x,
    y,
    width,
    height,
    angle: 0,
    isDeleted: false,
    ...extra,
  } as never);

describe("planPdfPages", () => {
  it("separate layout: one PDF page per page, gaps skipped", () => {
    const setup = updatePageSetup(null, { layout: "separate", pageCount: 3 });
    const plans = planPdfPages(setup, []);
    expect(plans).toHaveLength(3);
    expect(plans[1].rect.y).toBe(setup.height + PAGE_GAP);
    expect(plans[2].rect.y).toBe(2 * (setup.height + PAGE_GAP));
    const pt = getPageSizeInPoints(setup);
    expect(plans[0]).toMatchObject({ widthPt: pt.width, heightPt: pt.height });
    // A4 is exactly 595 x 842 pt
    expect([plans[0].widthPt, plans[0].heightPt]).toEqual([595, 842]);
  });

  it("continuous layout: split at page-size breaks, no gap", () => {
    const setup = updatePageSetup(null, { layout: "continuous", pageCount: 2 });
    const plans = planPdfPages(setup, []);
    expect(plans.map((p) => p.rect.y)).toEqual([0, setup.height]);
    expect(plans.every((p) => p.rect.height === setup.height)).toBe(true);
  });

  it("landscape swaps the media box", () => {
    const setup = updatePageSetup(null, {
      orientation: "landscape",
      pageCount: 1,
    });
    const [plan] = planPdfPages(setup, []);
    expect([plan.widthPt, plan.heightPt]).toEqual([842, 595]);
    expect(plan.rect.width).toBeGreaterThan(plan.rect.height);
  });

  it("custom size uses 0.75 pt per px", () => {
    const setup = updatePageSetup(null, {
      size: "custom",
      width: 400,
      height: 800,
      pageCount: 1,
    });
    const [plan] = planPdfPages(setup, []);
    expect([plan.widthPt, plan.heightPt]).toEqual([300, 600]);
  });

  it("empty pages are still pages", () => {
    const setup = updatePageSetup(null, { pageCount: 5 });
    expect(planPdfPages(setup, [])).toHaveLength(5);
  });

  it("normal mode: one page around the content plus padding", () => {
    for (const setup of [null, updatePageSetup(null, { enabled: false })]) {
      const [plan] = planPdfPages(setup, [
        el(100, 50, 200, 100),
        el(0, 0, 9999, 9999, { isDeleted: true }),
      ]);
      expect(planPdfPages(setup, [el(100, 50, 200, 100)])).toHaveLength(1);
      expect(plan.rect).toEqual({
        x: 90,
        y: 40,
        width: 220,
        height: 120,
      });
      expect(plan.widthPt).toBe(220 * 0.75);
      expect(plan.heightPt).toBe(120 * 0.75);
    }
  });

  it("normal mode with nothing to export is an error", () => {
    expect(() => planPdfPages(null, [])).toThrow(/empty/);
  });
});

describe("clampRenderScale", () => {
  it("keeps the scale for normal pages", () => {
    expect(clampRenderScale(794, 1123, 2)).toBe(2);
  });
  it("lowers it for huge content", () => {
    const s = clampRenderScale(20000, 20000, 2);
    expect(s).toBeLessThan(0.5);
    expect(20000 * s).toBeLessThanOrEqual(8192);
  });
});
