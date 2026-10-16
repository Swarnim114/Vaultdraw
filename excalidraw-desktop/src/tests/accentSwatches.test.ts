import { describe, expect, it } from "vitest";

import {
  ACCENT_PRESETS,
  accentSwatches,
} from "../components/settings/accentSwatches";

describe("accentSwatches", () => {
  it("puts the theme's own accent first and selects it when nothing is saved", () => {
    const { swatches, custom } = accentSwatches("#ea9875", "");
    expect(swatches[0]).toMatchObject({
      hex: "",
      paint: "#ea9875",
      name: "Theme accent",
      selected: true,
    });
    expect(swatches).toHaveLength(1 + ACCENT_PRESETS.length);
    expect(swatches.slice(1).some((s) => s.selected)).toBe(false);
    expect(custom).toBeNull();
  });

  it("selects the matching preset (case-insensitively) instead of the theme's", () => {
    const { swatches, custom } = accentSwatches("#ea9875", "#3B7FE0");
    expect(swatches.filter((s) => s.selected).map((s) => s.name)).toEqual([
      "Blue",
    ]);
    expect(custom).toBeNull();
  });

  it("drops a preset that equals the theme's own accent", () => {
    const { swatches } = accentSwatches("#3b7fe0", "");
    expect(swatches.map((s) => s.name)).not.toContain("Blue");
    expect(swatches).toHaveLength(ACCENT_PRESETS.length);
  });

  it("treats a saved accent equal to the theme's own as the theme swatch", () => {
    const { swatches, custom } = accentSwatches("#ea9875", "#EA9875");
    expect(swatches[0].selected).toBe(true);
    expect(custom).toBeNull();
  });

  it("reports a colour that matches no swatch as custom", () => {
    const { swatches, custom } = accentSwatches("#ea9875", "#123456");
    expect(swatches.some((s) => s.selected)).toBe(false);
    expect(custom).toBe("#123456");
  });
});
