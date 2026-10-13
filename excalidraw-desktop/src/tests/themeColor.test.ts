/**
 * Theme engine colour maths: hex parsing, OKLab/OKLCH round-trips, mixing,
 * WCAG contrast and contrast nudging.
 */
import { describe, expect, it } from "vitest";

import {
  contrastRatio,
  ensureContrast,
  ensureContrastAll,
  formatHex,
  hexToOklab,
  hexToOklch,
  isHexColor,
  mix,
  mixOklch,
  normalizeHex,
  oklabToHex,
  oklchToHex,
  parseHex,
  relativeLuminance,
  stepToward,
  toRgba,
} from "../theme/color";

/** mulberry32: small deterministic PRNG for reproducible random cases. */
const prng = (seed: number) => () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const randomHex = (rand: () => number) =>
  `#${Math.floor(rand() * 0xffffff)
    .toString(16)
    .padStart(6, "0")}`;

describe("hex parsing", () => {
  it("accepts #rgb, #rgba, #rrggbb and #rrggbbaa case-insensitively", () => {
    expect(normalizeHex("#FFF")).toBe("#ffffff");
    expect(normalizeHex("#abc")).toBe("#aabbcc");
    expect(normalizeHex("#AbCdEf")).toBe("#abcdef");
    expect(normalizeHex("#11223380")).toBe("#112233");
    expect(normalizeHex("  #123456 ")).toBe("#123456");
    expect(parseHex("#11223380")?.a).toBeCloseTo(128 / 255, 5);
    expect(parseHex("#f008")?.a).toBeCloseTo(136 / 255, 5);
  });

  it("rejects anything else", () => {
    for (const bad of [
      "",
      "fff",
      "#ff",
      "#fffff",
      "#ggg",
      "red",
      "rgb(0,0,0)",
    ]) {
      expect(normalizeHex(bad)).toBeNull();
      expect(isHexColor(bad)).toBe(false);
    }
    expect(isHexColor(42)).toBe(false);
  });

  it("formats with optional alpha", () => {
    expect(formatHex({ r: 1, g: 0, b: 0, a: 0.5 }, true)).toBe("#ff000080");
    expect(formatHex({ r: 1, g: 0, b: 0, a: 0.5 })).toBe("#ff0000");
    expect(toRgba("#ff8000", 0.25)).toBe("rgba(255, 128, 0, 0.25)");
  });
});

describe("OKLab / OKLCH", () => {
  it("matches reference values", () => {
    expect(hexToOklab("#ffffff").l).toBeCloseTo(1, 4);
    expect(hexToOklab("#000000").l).toBeCloseTo(0, 4);
    const red = hexToOklch("#ff0000");
    expect(red.l).toBeCloseTo(0.628, 3);
    expect(red.c).toBeCloseTo(0.2577, 3);
    expect(red.h).toBeCloseTo(29.23, 1);
    expect(hexToOklch("#808080").c).toBeLessThan(1e-4);
  });

  it("round-trips 2000 random colours exactly", () => {
    const rand = prng(1);
    for (let i = 0; i < 2000; i++) {
      const hex = randomHex(rand);
      expect(oklabToHex(hexToOklab(hex))).toBe(hex);
      expect(oklchToHex(hexToOklch(hex))).toBe(hex);
    }
  });

  it("gamut-maps out-of-range OKLCH to a valid colour keeping lightness", () => {
    const hex = oklchToHex({ l: 0.9, c: 0.4, h: 140 });
    expect(isHexColor(hex)).toBe(true);
    expect(hexToOklch(hex).l).toBeCloseTo(0.9, 2);
  });
});

describe("mixing", () => {
  it("returns the endpoints at t=0 and t=1", () => {
    expect(mix("#123456", "#abcdef", 0)).toBe("#123456");
    expect(mix("#123456", "#abcdef", 1)).toBe("#abcdef");
    expect(mixOklch("#ff0000", "#0000ff", 0)).toBe("#ff0000");
    expect(mixOklch("#ff0000", "#0000ff", 1)).toBe("#0000ff");
  });

  it("mixes greys to greys and is perceptually midway", () => {
    const mid = mix("#000000", "#ffffff", 0.5);
    expect(hexToOklch(mid).c).toBeLessThan(0.002);
    expect(hexToOklab(mid).l).toBeCloseTo(0.5, 2);
  });

  it("stepToward moves the requested OKLab distance", () => {
    const out = stepToward("#ffffff", "#000000", 0.1);
    expect(hexToOklab(out).l).toBeCloseTo(0.9, 2);
    expect(stepToward("#ffffff", "#fefefe", 0.5)).toBe("#fefefe");
  });
});

describe("WCAG contrast", () => {
  it("computes reference ratios", () => {
    expect(contrastRatio("#ffffff", "#000000")).toBeCloseTo(21, 5);
    expect(contrastRatio("#abcdef", "#abcdef")).toBe(1);
    expect(contrastRatio("#777777", "#ffffff")).toBeCloseTo(4.48, 2);
    expect(relativeLuminance("#ffffff")).toBeCloseTo(1, 6);
  });

  it("ensureContrast leaves passing colours alone", () => {
    expect(ensureContrast("#000000", "#ffffff", 7)).toBe("#000000");
    expect(ensureContrast("#ABCDEF", "#000000", 3)).toBe("#abcdef");
  });

  it("ensureContrast nudges lightness only until it passes, keeping hue", () => {
    const rand = prng(7);
    for (let i = 0; i < 500; i++) {
      const fg = randomHex(rand);
      const bg = randomHex(rand);
      for (const min of [3, 4.5, 7]) {
        const out = ensureContrast(fg, bg, min);
        const best = Math.max(
          contrastRatio("#ffffff", bg),
          contrastRatio("#000000", bg),
        );
        if (best >= min) {
          expect(contrastRatio(out, bg)).toBeGreaterThanOrEqual(min);
        }
      }
    }
    const nudged = ensureContrast("#8888ff", "#ffffff", 4.5);
    expect(contrastRatio(nudged, "#ffffff")).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(nudged, "#ffffff")).toBeLessThan(5);
    expect(
      Math.abs(hexToOklch(nudged).h - hexToOklch("#8888ff").h),
    ).toBeLessThan(5);
  });

  it("ensureContrastAll satisfies every background", () => {
    const bgs = ["#1a1b26", "#24283b", "#2a2d40"];
    const out = ensureContrastAll("#565f89", bgs, 7);
    for (const bg of bgs) {
      expect(contrastRatio(out, bg)).toBeGreaterThanOrEqual(7);
    }
  });
});
