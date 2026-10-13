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

/** id of the fallback <style> element carrying Excalidraw variable overrides. */
export const EXCALIDRAW_OVERRIDE_STYLE_ID = "vault-theme-excalidraw-vars";

export type AppliedTheme = {
  /** Inline values on <html> before this call ("" = was not set). */
  previous: Record<string, string>;
  /** Restores the previous inline values and removes the override stylesheet. */
  restore: () => void;
};

/** Constructed stylesheets per document (CSP-safe path, see below). */
const constructedSheets = new WeakMap<Document, CSSStyleSheet>();

const canAdoptStyleSheets = (doc: Document) => {
  const win = doc.defaultView as (Window & typeof globalThis) | null;
  return (
    !!win &&
    Array.isArray(doc.adoptedStyleSheets) &&
    typeof win.CSSStyleSheet === "function" &&
    typeof win.CSSStyleSheet.prototype.replaceSync === "function"
  );
};

/**
 * Writes the Excalidraw override CSS and returns a function restoring the
 * previous state.
 *
 * The packaged app's CSP carries a style nonce, which disables
 * 'unsafe-inline', so an injected <style> element is silently ignored there.
 * Constructed stylesheets (adoptedStyleSheets) are not subject to style-src,
 * so they are used whenever available; the <style> element remains as a
 * fallback for environments without them (jsdom in unit tests).
 */
const writeOverrideCss = (doc: Document, css: string): (() => void) => {
  if (canAdoptStyleSheets(doc)) {
    const win = doc.defaultView as Window & typeof globalThis;
    let sheet = constructedSheets.get(doc);
    const added = !sheet;
    const previousCss = sheet
      ? Array.from(sheet.cssRules, (rule) => rule.cssText).join("\n")
      : "";
    if (!sheet) {
      sheet = new win.CSSStyleSheet();
      constructedSheets.set(doc, sheet);
      doc.adoptedStyleSheets = [...doc.adoptedStyleSheets, sheet];
    }
    sheet.replaceSync(css);
    const current = sheet;
    return () => {
      if (added) {
        doc.adoptedStyleSheets = doc.adoptedStyleSheets.filter(
          (s) => s !== current,
        );
        constructedSheets.delete(doc);
      } else {
        current.replaceSync(previousCss);
      }
    };
  }

  let style = doc.getElementById(EXCALIDRAW_OVERRIDE_STYLE_ID);
  const previousCss = style ? style.textContent : null;
  if (!style) {
    style = doc.createElement("style");
    style.id = EXCALIDRAW_OVERRIDE_STYLE_ID;
    (doc.head ?? doc.documentElement).appendChild(style);
  }
  style.textContent = css;
  const styleEl = style;
  return () => {
    if (previousCss === null) {
      styleEl.remove();
    } else {
      styleEl.textContent = previousCss;
    }
  };
};

/**
 * Sets every token and Excalidraw variable as an inline custom property on
 * `doc.documentElement`.
 *
 * Excalidraw re-declares its variables on `.excalidraw` /
 * `.excalidraw.theme--dark`, which beats inheritance from <html>, so the
 * Excalidraw variables are additionally written to a stylesheet whose
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

  const body = Object.entries(excalidrawVars)
    .map(([name, value]) => `  ${name}: ${value};`)
    .join("\n");
  const restoreCss = writeOverrideCss(
    doc,
    `:root .excalidraw,\n:root .excalidraw.theme--dark {\n${body}\n}\n`,
  );

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
      restoreCss();
    },
  };
};
