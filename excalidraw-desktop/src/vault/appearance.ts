/**
 * Applies the active colour theme to the document: `--vault-*` tokens and
 * Excalidraw UI variables (theme engine `applyThemeTokens`) plus the
 * `html.dark` class. Used before the first paint (main.tsx) and by
 * useAppearance whenever the theme, mode, OS appearance or theme files change.
 *
 * The stock Default theme applies nothing: VaultShell.css and Excalidraw's
 * own stylesheet render exactly the pre-theme look.
 */

import {
  applyThemeTokens,
  deriveTokens,
  excalidrawVariableOverrides,
  pickOn,
} from "../theme";
import {
  isStockDefault,
  resolveSelectedTheme,
  type ThemeEntry,
  type ThemeRegistry,
} from "../theme/registry";

import { resolveTheme, type VaultPreferences } from "./preferences";

import type { AppliedTheme, ThemeMode, ThemeVariant } from "../theme";

export interface AppearanceSnapshot {
  /** Resolved mode (light/dark/system → actual). */
  mode: ThemeMode;
  entry: ThemeEntry;
  /** The entry's variant for `mode`. */
  variant: ThemeVariant;
  syncCanvas: boolean;
  /** Unknown/broken selected theme (Default is used instead). */
  problem: string | null;
  /** Stable identity of what is shown (theme content + mode + sync). */
  key: string;
}

export const computeAppearance = (
  prefs: Pick<VaultPreferences, "theme" | "colorTheme" | "syncCanvas">,
  registry: ThemeRegistry,
  win: Window | null | undefined,
): AppearanceSnapshot => {
  const mode = resolveTheme(prefs.theme, win);
  const { entry, problem } = resolveSelectedTheme(registry, prefs.colorTheme);
  const variant = entry.theme[mode];
  const syncCanvas = !!prefs.syncCanvas;
  const key = `${entry.source}:${entry.key}:${mode}:${
    syncCanvas ? 1 : 0
  }:${JSON.stringify(variant)}`;
  return { mode, entry, variant, syncCanvas, problem, key };
};

let applied: {
  doc: Document;
  key: string;
  handle: AppliedTheme | null;
} | null = null;

/** Token key (theme content + mode); sync does not change the chrome. */
const tokenKey = (s: AppearanceSnapshot) =>
  isStockDefault(s.entry)
    ? `default:${s.mode}`
    : `${s.entry.source}:${s.entry.key}:${s.mode}:${JSON.stringify(s.variant)}`;

/**
 * Writes the snapshot's tokens to `doc` (idempotent) and syncs `html.dark`.
 * Returns true when the tokens changed.
 */
export const applyAppearance = (
  doc: Document,
  snapshot: AppearanceSnapshot,
): boolean => {
  const root = doc.documentElement;
  root.classList.toggle("dark", snapshot.mode === "dark");
  root.dataset.vaultTheme = snapshot.entry.key;
  root.dataset.vaultCanvasSync = snapshot.syncCanvas ? "on" : "off";

  const key = tokenKey(snapshot);
  if (applied && applied.doc === doc && applied.key === key) {
    return false;
  }
  if (applied && applied.doc === doc) {
    applied.handle?.restore();
  }
  let handle: AppliedTheme | null = null;
  if (!isStockDefault(snapshot.entry)) {
    const tokens = deriveTokens(snapshot.variant, snapshot.mode);
    handle = applyThemeTokens(
      doc,
      {
        ...tokens,
        // Label on danger buttons (dark themes have light danger colours).
        "--vault-on-danger": pickOn(
          tokens["--vault-danger"],
          ["#ffffff", tokens["--vault-bg"], "#000000"],
          4.5,
        ),
      },
      excalidrawVariableOverrides(tokens, snapshot.mode),
    );
  }
  applied = { doc, key, handle };
  return true;
};

/** Removes everything applyAppearance added (tests). */
export const resetAppliedAppearance = () => {
  applied?.handle?.restore();
  applied = null;
};
