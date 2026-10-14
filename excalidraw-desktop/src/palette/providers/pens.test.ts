import { describe, expect, it, vi } from "vitest";

import { createPensProvider } from "./pens";

import type { PenPreset } from "../../pens/penPresets";

const preset = (name: string): PenPreset => ({
  name,
  color: "#000",
  width: 2,
  opacity: 100,
  pressure: false,
  smoothing: 0.3,
  highlighter: false,
});

describe("pens provider", () => {
  it("lists presets with names, shortcuts, active mark and selection", () => {
    const select = vi.fn();
    const provider = createPensProvider({
      platform: "mac",
      presets: () => [preset("Marker"), preset("  ")],
      overrides: () => ({ "pen.select2": ["Alt+9"] }),
      active: () => 0,
      select,
    });
    const items = provider.items();
    expect(items.map((i) => [i.key, i.title, i.checked, i.group])).toEqual([
      ["pen:0", "Pen: Marker", true, "Pens"],
      ["pen:1", "Pen: Pen 2", false, "Pens"],
    ]);
    expect(items[0].shortcut).toBe("⌥1");
    expect(items[1].shortcut).toBe("⌥9");
    void items[1].run();
    expect(select).toHaveBeenCalledWith(1);
  });
});
