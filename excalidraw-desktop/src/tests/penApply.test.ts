import { describe, expect, it } from "vitest";

import {
  laserToPointerSettings,
  penToAppState,
  penToFreedrawPen,
} from "../pens/penApply";
import { DEFAULT_PEN_PRESETS } from "../pens/penPresets";

const [fine, , brush, , highlighter] = DEFAULT_PEN_PRESETS;

describe("penApply", () => {
  it("maps colour, opacity and pressure to app state", () => {
    expect(penToAppState(highlighter)).toEqual({
      currentItemStrokeColor: "#ffd43b",
      currentItemOpacity: 40,
      currentItemStrokeVariability: "constant",
    });
    expect(penToAppState(brush).currentItemStrokeVariability).toBe("variable");
  });

  it("maps smoothing and highlighter and scales width to the renderer", () => {
    const hl = penToFreedrawPen(highlighter);
    expect(hl).toMatchObject({ streamline: 0.5, behind: true });
    // constant pens render at strokeWidth * 1.4
    expect(hl.strokeWidth).toBeCloseTo(10 / 1.4, 2);
    expect(penToFreedrawPen(fine).behind).toBe(false);
    // pressure pens render at strokeWidth * 4.25
    expect(penToFreedrawPen(brush).strokeWidth).toBeCloseTo(1.5 / 4.25, 2);
  });

  it("maps laser preferences", () => {
    expect(
      laserToPointerSettings({
        laserColor: "#0f0",
        laserSize: 4,
        laserDecayMs: 800,
        laserLength: 30,
      }),
    ).toEqual({ color: "#0f0", size: 4, decayMs: 800, length: 30 });
  });
});
