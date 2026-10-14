import { describe, expect, it } from "vitest";

import { getCommonBounds } from "@excalidraw/element";
import { DEFAULT_PAGE_SETUP } from "@excalidraw/excalidraw/data/pageSetup";

import type { PageSetup } from "@excalidraw/excalidraw/data/pageSetup";

import { fitContentToPage, PAGE_CONTENT_MARGIN } from "./fitContent";
import { arrow, rect } from "./testElements";

const separate: PageSetup = { ...DEFAULT_PAGE_SETUP, pageCount: 1 };
const continuous: PageSetup = { ...separate, layout: "continuous" };
const live = (r: { elements: readonly any[] }) =>
  r.elements.filter((e) => !e.isDeleted);

describe("fitContentToPage", () => {
  it("returns null for an empty drawing", () => {
    expect(fitContentToPage([], separate)).toBeNull();
    expect(
      fitContentToPage([rect(0, 0, 10, 10, { isDeleted: true })], separate),
    ).toBeNull();
  });

  it("moves small content to the top-left margin without scaling it", () => {
    const a = rect(3000, 4000, 100, 60);
    const result = fitContentToPage([a], separate)!;
    const [el] = live(result);
    expect(el.x).toBe(PAGE_CONTENT_MARGIN);
    expect(el.y).toBe(PAGE_CONTENT_MARGIN);
    expect(el.width).toBe(100);
    expect(result.pageCount).toBe(1);
  });

  it("scales wide content down uniformly to the page width minus margins", () => {
    const a = rect(-2000, 100, 4000, 1000);
    const b = rect(500, 3000, 100, 100);
    const result = fitContentToPage([a, b], continuous)!;
    const [x1, y1, x2] = getCommonBounds(live(result));
    expect(x1).toBeCloseTo(PAGE_CONTENT_MARGIN, 3);
    expect(y1).toBeCloseTo(PAGE_CONTENT_MARGIN, 3);
    expect(x2 - x1).toBeCloseTo(continuous.width - 2 * PAGE_CONTENT_MARGIN, 3);
    const [ra] = live(result);
    expect(ra.width / ra.height).toBeCloseTo(4, 5);
  });

  it("scales arrow points with the content", () => {
    const a = rect(0, 0, 3000, 100);
    const link = arrow(0, 200, 3000, 0);
    const result = fitContentToPage([a, link], continuous)!;
    const [, la] = live(result);
    const scale = (continuous.width - 2 * PAGE_CONTENT_MARGIN) / 3000;
    expect((la as any).points[1][0]).toBeCloseTo(3000 * scale, 3);
  });

  it("grows the page count to cover tall content", () => {
    const a = rect(0, 0, 600, 4000);
    const result = fitContentToPage([a], continuous)!;
    expect(result.pageCount).toBeGreaterThanOrEqual(4);
  });

  it("separate layout moves units that straddle a page break to the next page", () => {
    const pitch = separate.height + 40;
    const top = rect(50, 0, 200, 100);
    const straddle = rect(50, separate.height - 60, 200, 120);
    const result = fitContentToPage([top, straddle], separate)!;
    const [, s] = live(result);
    expect(s.y).toBeGreaterThanOrEqual(pitch);
    expect(result.pageCount).toBe(2);
  });

  it("does not mutate the input elements", () => {
    const a = rect(3000, 4000, 100, 60);
    fitContentToPage([a], separate);
    expect(a.x).toBe(3000);
  });
});
