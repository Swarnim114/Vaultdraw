import {
  CONSTANT_WIDTH_FREEDRAW,
  VARIABLE_WIDTH_FREEDRAW,
} from "@excalidraw/element";

/** Pure mapping from a saved pen / laser setting to what the editor consumes. */
import type {
  AppState,
  FreedrawPen,
  LaserPointerSettings,
} from "@excalidraw/excalidraw/types";

import type { PenPreset } from "./penPresets";

type PenAppState = Pick<
  AppState,
  | "currentItemStrokeColor"
  | "currentItemOpacity"
  | "currentItemStrokeVariability"
>;

/** Colour, opacity and pressure live in the editor's regular app state. */
export const penToAppState = (preset: PenPreset): PenAppState => ({
  currentItemStrokeColor: preset.color,
  currentItemOpacity: preset.opacity,
  currentItemStrokeVariability: preset.pressure ? "variable" : "constant",
});

/** Preset width is the visual thickness in px; the renderer scales strokeWidth. */
const toStrokeWidth = (preset: PenPreset) =>
  Math.round(
    (preset.width /
      (preset.pressure
        ? VARIABLE_WIDTH_FREEDRAW.SIZE_FACTOR
        : CONSTANT_WIDTH_FREEDRAW.SIZE_FACTOR)) *
      1000,
  ) / 1000;

/** Width, smoothing and z-order are per-stroke overrides (`freedrawPen` prop). */
export const penToFreedrawPen = (preset: PenPreset): FreedrawPen => ({
  strokeWidth: toStrokeWidth(preset),
  streamline: preset.smoothing,
  behind: preset.highlighter,
});

export interface LaserPrefs {
  laserColor: string;
  laserSize: number;
  laserDecayMs: number;
  laserLength: number;
}

export const laserToPointerSettings = (
  prefs: LaserPrefs,
): LaserPointerSettings => ({
  color: prefs.laserColor,
  size: prefs.laserSize,
  decayMs: prefs.laserDecayMs,
  length: prefs.laserLength,
});
