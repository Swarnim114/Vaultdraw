/**
 * The app's default page setup for new drawings: the `page*` preferences
 * <-> a PageSetup. The preferences spell the paper theme like config.toml
 * ("old_school"); the model says "oldSchool".
 */
import {
  normalizePageSetup,
  type PageSetup,
  type PaperTheme,
} from "@excalidraw/excalidraw/data/pageSetup";

import { getPreferences, updatePreferences } from "./preferences";

import type { PagePaperTheme, VaultPreferences } from "./preferences";

export type PagePrefs = Pick<
  VaultPreferences,
  | "pageMode"
  | "pageLayout"
  | "pageSize"
  | "pageOrientation"
  | "pageWidth"
  | "pageHeight"
  | "pagePaperTheme"
>;

const THEME_FROM_PREF: Record<PagePaperTheme, PaperTheme> = {
  normal: "normal",
  old_school: "oldSchool",
  match: "match",
};

const THEME_TO_PREF: Record<PaperTheme, PagePaperTheme> = {
  normal: "normal",
  oldSchool: "old_school",
  match: "match",
};

/** A valid setup; `enabled` = the default mode is "page". Unset (0) custom sides use A4's. */
export function pageSetupFromPagePrefs(prefs: PagePrefs): PageSetup {
  return normalizePageSetup({
    enabled: prefs.pageMode === "page",
    layout: prefs.pageLayout,
    size: prefs.pageSize,
    orientation: prefs.pageOrientation,
    ...(prefs.pageWidth > 0 && { width: prefs.pageWidth }),
    ...(prefs.pageHeight > 0 && { height: prefs.pageHeight }),
    pageCount: 1,
    paperTheme: THEME_FROM_PREF[prefs.pagePaperTheme],
  })!;
}

/** Inverse of pageSetupFromPagePrefs. Custom sizes keep their pixels; presets reset them to unset. */
export function pagePrefsFromPageSetup(setup: PageSetup): PagePrefs {
  const custom = setup.size === "custom";
  return {
    pageMode: setup.enabled ? "page" : "normal",
    pageLayout: setup.layout,
    pageSize: setup.size,
    pageOrientation: setup.orientation,
    pageWidth: custom ? setup.width : 0,
    pageHeight: custom ? setup.height : 0,
    pagePaperTheme: THEME_TO_PREF[setup.paperTheme],
  };
}

/** The app default as a setup (also when its mode is Normal). */
export function getDefaultPageSetup(win?: Window | null): PageSetup {
  return pageSetupFromPagePrefs(getPreferences(win));
}

/** Makes `setup` the app default ("Make app default"). */
export function setDefaultPageSetup(
  setup: PageSetup,
  win?: Window | null,
): void {
  updatePreferences(pagePrefsFromPageSetup(setup), win);
}

/** The setup to stamp on a new drawing; null when the default mode is Normal. */
export function getNewDrawingPageSetup(win?: Window | null): PageSetup | null {
  const setup = getDefaultPageSetup(win);
  return setup.enabled ? setup : null;
}
