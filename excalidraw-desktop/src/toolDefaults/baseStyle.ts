/**
 * The base style of a drawing: the shared current-item state used when no
 * styled tool is active and for keys a tool does not set. Excalidraw's
 * built-ins, with the [editor] defaults (Settings > Drawing) on top. Drawings
 * never store it (currentItem* is not exported), so it is applied on open and
 * whenever those preferences change.
 */
import { getDefaultAppState } from "@excalidraw/excalidraw/appState";

import type { AppState } from "@excalidraw/excalidraw/types";

import { STYLE_FIELDS, nearestStrokeWidthKey } from "./toolApply";

import type { VaultPreferences } from "../vault/preferences";

type EditorDefaults = Pick<
  VaultPreferences,
  | "defaultFontFamily"
  | "defaultFontSize"
  | "defaultStrokeColor"
  | "defaultBackgroundColor"
  | "defaultFillStyle"
  | "defaultStrokeWidth"
  | "defaultRoughness"
>;

/** The `[editor]` preference fields, for change detection. */
export const editorDefaultsKey = (prefs: EditorDefaults): string =>
  JSON.stringify([
    prefs.defaultFontFamily,
    prefs.defaultFontSize,
    prefs.defaultStrokeColor,
    prefs.defaultBackgroundColor,
    prefs.defaultFillStyle,
    prefs.defaultStrokeWidth,
    prefs.defaultRoughness,
  ]);

/** AppState patch (mapped style fields only) holding the base style. */
export function baseStyleAppState(prefs: EditorDefaults): Partial<AppState> {
  const builtin = getDefaultAppState() as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const field of STYLE_FIELDS) {
    out[field] = builtin[field];
  }
  Object.assign(out, {
    currentItemFontFamily: prefs.defaultFontFamily,
    currentItemFontSize: prefs.defaultFontSize,
    currentItemStrokeColor: prefs.defaultStrokeColor,
    currentItemBackgroundColor: prefs.defaultBackgroundColor,
    currentItemFillStyle: prefs.defaultFillStyle,
    currentItemStrokeWidthKey: nearestStrokeWidthKey(prefs.defaultStrokeWidth),
    currentItemRoughness: prefs.defaultRoughness,
  });
  return out as Partial<AppState>;
}
