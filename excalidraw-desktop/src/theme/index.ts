/**
 * Theme engine public API.
 *
 *   const theme = loadBuiltinThemes()[0];
 *   const variant = theme[mode];
 *   const tokens = deriveTokens(variant, mode);
 *   const handle = applyThemeTokens(document, tokens,
 *     excalidrawVariableOverrides(tokens, mode));
 *   // later: handle.restore();
 */

import catppuccin from "./builtin/catppuccin.json";
import defaultTheme from "./builtin/default.json";
import dracula from "./builtin/dracula.json";
import everforest from "./builtin/everforest.json";
import gruvbox from "./builtin/gruvbox.json";
import nord from "./builtin/nord.json";
import rosePine from "./builtin/rose-pine.json";
import solarized from "./builtin/solarized.json";
import tokyoNight from "./builtin/tokyo-night.json";
import { parseThemeFile } from "./normalize";

import type { ResolvedTheme } from "./types";

export * from "./types";
export * from "./color";
export {
  parseThemeFile,
  resolveVariant,
  generateVariant,
  slugify,
} from "./normalize";
export { deriveTokens, CONTRAST } from "./tokens";
export { excalidrawVariableOverrides } from "./excalidrawVars";
export {
  buildCanvasColorTransform,
  buildCanvasPaletteMap,
  resolveFamilyTargets,
  HUE_FAMILIES,
} from "./canvas";

/** Built-in theme files in display order, with the name used if a file lacks one. */
export const BUILTIN_THEME_FILES: ReadonlyArray<[string, unknown]> = [
  ["Default", defaultTheme],
  ["Dracula", dracula],
  ["Tokyo Night", tokyoNight],
  ["Catppuccin", catppuccin],
  ["Everforest", everforest],
  ["Gruvbox", gruvbox],
  ["Nord", nord],
  ["Rosé Pine", rosePine],
  ["Solarized", solarized],
];

export const DEFAULT_THEME_ID = "default";

let builtinCache: ResolvedTheme[] | null = null;

/** Parses (once) and returns every built-in theme, Default first. */
export const loadBuiltinThemes = (): ResolvedTheme[] => {
  if (!builtinCache) {
    builtinCache = BUILTIN_THEME_FILES.map(([name, json]) =>
      parseThemeFile(json, name),
    );
  }
  return builtinCache;
};

/** id of the <style> element carrying Excalidraw variable overrides. */
export const EXCALIDRAW_OVERRIDE_STYLE_ID = "vault-theme-excalidraw-vars";

export type AppliedTheme = {
  /** Inline values on <html> before this call ("" = was not set). */
  previous: Record<string, string>;
  /** Restores the previous inline values and removes the override stylesheet. */
  restore: () => void;
};

/**
 * Sets every token and Excalidraw variable as an inline custom property on
 * `doc.documentElement`.
 *
 * Excalidraw re-declares its variables on `.excalidraw` /
 * `.excalidraw.theme--dark`, which beats inheritance from <html>, so the
 * Excalidraw variables are additionally written to a <style> element whose
 * selectors (`:root .excalidraw`, `:root .excalidraw.theme--dark`) out-rank
 * theme.scss. Calling it again replaces that stylesheet's contents.
 */
export const applyThemeTokens = (
  doc: Document,
  tokens: Record<string, string>,
  excalidrawVars: Record<string, string>,
): AppliedTheme => {
  const root = doc.documentElement;
  const previous: Record<string, string> = {};
  const all = { ...tokens, ...excalidrawVars };
  for (const [name, value] of Object.entries(all)) {
    previous[name] = root.style.getPropertyValue(name);
    root.style.setProperty(name, value);
  }

  let style = doc.getElementById(EXCALIDRAW_OVERRIDE_STYLE_ID);
  const previousCss = style ? style.textContent : null;
  if (!style) {
    style = doc.createElement("style");
    style.id = EXCALIDRAW_OVERRIDE_STYLE_ID;
    (doc.head ?? root).appendChild(style);
  }
  const body = Object.entries(excalidrawVars)
    .map(([name, value]) => `  ${name}: ${value};`)
    .join("\n");
  style.textContent = `:root .excalidraw,\n:root .excalidraw.theme--dark {\n${body}\n}\n`;

  const styleEl = style;
  return {
    previous,
    restore: () => {
      for (const [name, value] of Object.entries(previous)) {
        if (value) {
          root.style.setProperty(name, value);
        } else {
          root.style.removeProperty(name);
        }
      }
      if (previousCss === null) {
        styleEl.remove();
      } else {
        styleEl.textContent = previousCss;
      }
    },
  };
};
