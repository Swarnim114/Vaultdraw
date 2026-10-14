/** Remembered image export options <-> editor appState export fields. */

import type { AppState } from "@excalidraw/excalidraw/types";

import {
  getPreferences,
  updatePreferences,
  type ExportOptions,
} from "../vault/preferences";

type ExportFields = Pick<
  AppState,
  | "exportScale"
  | "exportBackground"
  | "exportEmbedScene"
  | "exportBackgroundPattern"
  | "exportPageShaped"
>;

export const exportOptionsToAppState = (opts: ExportOptions): ExportFields => ({
  exportScale: opts.scale,
  exportBackground: opts.background,
  exportEmbedScene: opts.embedScene,
  exportBackgroundPattern: opts.pattern,
  exportPageShaped: opts.pageShaped,
});

export const appStateToExportOptions = (
  appState: ExportFields,
): ExportOptions => ({
  scale: appState.exportScale as ExportOptions["scale"],
  background: appState.exportBackground,
  embedScene: appState.exportEmbedScene,
  pattern: appState.exportBackgroundPattern,
  pageShaped: appState.exportPageShaped,
});

let known: ExportOptions | null = null;

/** Stored options (refreshes the cache used by rememberExportOptions). */
export const loadExportOptions = (): ExportOptions => {
  known = getPreferences().exportOptions;
  return known;
};

/**
 * Persists the options only when they differ from the last known ones; the
 * common case is six comparisons and no allocation (runs on every change).
 */
export const rememberExportOptions = (appState: ExportFields): void => {
  const stored = known ?? loadExportOptions();
  if (
    stored.scale === appState.exportScale &&
    stored.background === appState.exportBackground &&
    stored.embedScene === appState.exportEmbedScene &&
    stored.pattern === appState.exportBackgroundPattern &&
    stored.pageShaped === appState.exportPageShaped
  ) {
    return;
  }
  const next = appStateToExportOptions(appState);
  if (next.scale === 1 || next.scale === 2 || next.scale === 3) {
    known = next;
    updatePreferences({ exportOptions: next });
  }
};
