import { describe, expect, it } from "vitest";

import { createBackgroundPattern } from "@excalidraw/excalidraw/data/backgroundPattern";
import {
  DEFAULT_PAGE_SETUP,
  PAPER_THEME_COLORS,
} from "@excalidraw/excalidraw/data/pageSetup";

import { getPageSetupPatch } from "./pageSetupChange";

const state = (
  viewBackgroundPattern: ReturnType<typeof createBackgroundPattern> | null,
) => ({
  pageSetup: { ...DEFAULT_PAGE_SETUP, enabled: true },
  viewBackgroundColor: "#ffffff",
  viewBackgroundPattern,
});

describe("getPageSetupPatch paper themes", () => {
  it("Old school on plain paper adds blue ruled lines with the red margin", () => {
    const patch = getPageSetupPatch(state(null), { paperTheme: "oldSchool" });
    expect(patch).toMatchObject({
      viewBackgroundColor: PAPER_THEME_COLORS.oldSchool.background,
      viewBackgroundPattern: {
        type: "lines",
        marginLine: true,
        color: PAPER_THEME_COLORS.oldSchool.patternColor,
      },
    });
  });

  it("Old school keeps a chosen pattern type and recolours it", () => {
    const patch = getPageSetupPatch(state(createBackgroundPattern("grid")), {
      paperTheme: "oldSchool",
    });
    expect(patch).toMatchObject({
      viewBackgroundPattern: {
        type: "grid",
        color: PAPER_THEME_COLORS.oldSchool.patternColor,
      },
    });
  });

  it("Normal on plain paper stays plain", () => {
    const patch = getPageSetupPatch(
      {
        ...state(null),
        pageSetup: { ...state(null).pageSetup, paperTheme: "oldSchool" },
      },
      { paperTheme: "normal" },
    );
    expect(patch).toMatchObject({
      viewBackgroundColor: "#ffffff",
      viewBackgroundPattern: null,
    });
  });

  it("no theme change leaves the colours alone", () => {
    expect(getPageSetupPatch(state(null), { layout: "continuous" })).toEqual({
      pageSetup: expect.objectContaining({ layout: "continuous" }),
    });
  });
});
