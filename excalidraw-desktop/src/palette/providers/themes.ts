/** Palette provider: "Theme: <name>" for every installed colour theme. */
import { listThemeSummaries, type ThemeRegistry } from "../../theme/registry";

import type { PaletteItem, PaletteProvider } from "../types";

export interface ThemesProviderDeps {
  registry(): ThemeRegistry;
  /** Key of the selected theme (after the Default fallback). */
  currentKey(): string;
  /** Select a theme by key, as the Appearance settings page does. */
  select(key: string): void;
}

export function createThemesProvider({
  registry,
  currentKey,
  select,
}: ThemesProviderDeps): PaletteProvider {
  return {
    id: "themes",
    items(): PaletteItem[] {
      const current = currentKey();
      return listThemeSummaries(registry()).map(({ key, name }) => ({
        key: `theme:${name}`,
        title: `Theme: ${name}`,
        group: "Appearance",
        keywords: ["colour", "color", "theme"],
        checked: key === current,
        run: () => select(key),
      }));
    },
  };
}
