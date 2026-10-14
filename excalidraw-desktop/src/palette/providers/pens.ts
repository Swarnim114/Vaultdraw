/**
 * Palette provider for the saved pen presets: "Pen: <name>". These replace
 * the pen.selectN commands, which are hidden from the palette.
 */
import { penCommandId } from "../../commands/commands";
import { commandShortcutLabel } from "../shortcuts";

import type { HotkeyOverrides, Platform } from "../../commands/types";
import type { PenPreset } from "../../pens/penPresets";
import type { PaletteProvider } from "../types";

interface Deps {
  platform: Platform;
  presets(): readonly PenPreset[];
  overrides(): HotkeyOverrides;
  /** Index of the active pen, null when none. */
  active(): number | null;
  /** The pen bar / Alt+N selection. */
  select(index: number): void;
}

export function createPensProvider(deps: Deps): PaletteProvider {
  return {
    id: "pens",
    items() {
      const active = deps.active();
      const overrides = deps.overrides();
      return deps.presets().map((preset, i) => ({
        key: `pen:${i}`,
        title: `Pen: ${preset.name.trim() || `Pen ${i + 1}`}`,
        keywords: ["pen", "draw", "freedraw", "brush", "marker"],
        group: "Pens",
        shortcut: commandShortcutLabel(
          penCommandId(i),
          overrides,
          deps.platform,
        ),
        checked: active === i,
        run: () => deps.select(i),
      }));
    },
  };
}
