/**
 * "Sync canvas with theme": installs the theme engine's display colour
 * transform into the editor (setDisplayColorTransform) and asks mounted
 * editors to repaint. Display only: scene data and exports keep standard
 * colours (exports run inside `withStandardCanvasColors`).
 */

import {
  invertColorForDarkMode,
  setDisplayColorTransform,
} from "@excalidraw/excalidraw";

import { buildCanvasColorTransform } from "../theme";

import type { ThemeMode, ThemeVariant } from "../theme";

type Transform = (color: string, isDarkMode: boolean) => string;

let currentKey = "off";
let currentTransform: Transform | null = null;
let suspended = 0;
const repainters = new Set<() => void>();

const repaintAll = () => {
  for (const repaint of repainters) {
    try {
      repaint();
    } catch {
      // an unmounting editor must not break the others
    }
  }
};

/**
 * Turns canvas sync on (variant given) or off (null). `key` identifies the
 * variant + mode; calling again with the same key does nothing. Returns true
 * when the transform changed.
 */
export const setCanvasSync = (
  sync: { variant: ThemeVariant; mode: ThemeMode; key: string } | null,
): boolean => {
  const key = sync ? `on:${sync.key}` : "off";
  if (key === currentKey) {
    return false;
  }
  currentKey = key;
  currentTransform = sync
    ? buildCanvasColorTransform(
        sync.variant,
        sync.mode,
        // NOT applyDarkModeFilter: that delegates back to this transform.
        invertColorForDarkMode,
      )
    : null;
  if (suspended === 0) {
    setDisplayColorTransform(currentTransform);
  }
  repaintAll();
  return true;
};

export const isCanvasSyncActive = () => currentTransform !== null;

/** Editors register a repaint callback (invalidate caches + re-render). */
export const registerCanvasRepaint = (repaint: () => void) => {
  repainters.add(repaint);
  return () => {
    repainters.delete(repaint);
  };
};

/**
 * Runs `task` with the standard (untransformed) colours, e.g. PNG/SVG export,
 * then restores the theme transform and repaints.
 */
export const withStandardCanvasColors = async <T>(
  task: () => Promise<T>,
): Promise<T> => {
  if (!currentTransform && suspended === 0) {
    return task();
  }
  if (suspended++ === 0) {
    setDisplayColorTransform(null);
  }
  try {
    return await task();
  } finally {
    if (--suspended === 0) {
      setDisplayColorTransform(currentTransform);
      repaintAll();
    }
  }
};

/** Test helper: back to "off" with no registered editors. */
export const resetCanvasSync = () => {
  currentKey = "off";
  currentTransform = null;
  suspended = 0;
  repainters.clear();
  setDisplayColorTransform(null);
};
