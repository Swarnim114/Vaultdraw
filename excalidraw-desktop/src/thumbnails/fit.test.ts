import { describe, expect, it } from "vitest";

import {
  fitThumb,
  thumbDensity,
  THUMB_BOX_CSS,
  THUMB_MAX_ZOOM,
  THUMB_PAD_RATIO,
} from "./fit";

const pad = (density: number) =>
  Math.round(
    Math.min(THUMB_BOX_CSS.width, THUMB_BOX_CSS.height) *
      density *
      THUMB_PAD_RATIO,
  );

/** The content rectangle lies inside the box with at least the padding. */
const expectInsidePadded = (f: ReturnType<typeof fitThumb>, p: number) => {
  expect(f.x).toBeGreaterThanOrEqual(p - 1);
  expect(f.y).toBeGreaterThanOrEqual(p - 1);
  expect(f.x + f.width).toBeLessThanOrEqual(f.boxWidth - p + 1);
  expect(f.y + f.height).toBeLessThanOrEqual(f.boxHeight - p + 1);
};

describe("thumbDensity", () => {
  it("is 2 on Retina and 1 otherwise", () => {
    expect(thumbDensity(2)).toBe(2);
    expect(thumbDensity(3)).toBe(2);
    expect(thumbDensity(1.5)).toBe(2);
    expect(thumbDensity(1.25)).toBe(1);
    expect(thumbDensity(1)).toBe(1);
    expect(thumbDensity(undefined)).toBe(1);
  });
});

describe("fitThumb", () => {
  it("always outputs the full 4:3 box at the density", () => {
    for (const d of [1, 2]) {
      const f = fitThumb(1000, 10, d);
      expect(f.boxWidth).toBe(THUMB_BOX_CSS.width * d);
      expect(f.boxHeight).toBe(THUMB_BOX_CSS.height * d);
      expect(f.boxWidth / f.boxHeight).toBeCloseTo(4 / 3);
    }
  });

  it("shrinks a large drawing to fit with padding, keeping its aspect (no crop)", () => {
    const f = fitThumb(3000, 2000, 2);
    expectInsidePadded(f, pad(2));
    expect(f.width / f.height).toBeCloseTo(3000 / 2000, 1);
    expect(f.scale).toBeCloseTo((f.boxWidth - 2 * pad(2)) / 3000);
  });

  it("letterboxes a very wide drawing: full width, centred vertically", () => {
    const f = fitThumb(6000, 40, 2);
    expect(f.width).toBe(f.boxWidth - 2 * pad(2));
    expect(f.height).toBeLessThan(f.boxHeight / 10);
    expect(f.y).toBe(Math.floor((f.boxHeight - f.height) / 2));
    expectInsidePadded(f, pad(2));
  });

  it("letterboxes a very tall drawing: full height, centred horizontally", () => {
    const f = fitThumb(40, 6000, 2);
    expect(f.height).toBe(f.boxHeight - 2 * pad(2));
    expect(f.x).toBe(Math.floor((f.boxWidth - f.width) / 2));
    expectInsidePadded(f, pad(2));
  });

  it("never magnifies a small drawing beyond the max zoom (a word stays a word)", () => {
    const f = fitThumb(64, 25, 2);
    expect(f.scale).toBe(THUMB_MAX_ZOOM * 2);
    expect(f.width).toBe(Math.ceil(64 * THUMB_MAX_ZOOM * 2));
    expect(f.x).toBe(Math.floor((f.boxWidth - f.width) / 2));
    expect(f.y).toBe(Math.floor((f.boxHeight - f.height) / 2));
  });

  it("renders the same scene at twice the pixels on Retina", () => {
    const a = fitThumb(3000, 2000, 1);
    const b = fitThumb(3000, 2000, 2);
    expect(b.scale / a.scale).toBeCloseTo(2, 1);
    expect(b.width).toBeGreaterThanOrEqual(2 * a.width - 2);
  });

  it("handles degenerate content (zero-size line or dot)", () => {
    for (const [w, h] of [
      [0, 0],
      [500, 0],
      [0, 500],
    ]) {
      const f = fitThumb(w, h, 2);
      expect(Number.isFinite(f.scale)).toBe(true);
      expect(f.width).toBeGreaterThanOrEqual(1);
      expect(f.height).toBeGreaterThanOrEqual(1);
      expectInsidePadded(f, pad(2));
    }
  });
});
