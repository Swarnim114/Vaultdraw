/** Live shortcut labels for UI that shows a command's current binding. */
import { useCallback, useMemo } from "react";

import { commandShortcutLabel } from "../palette/shortcuts";

import { detectPlatform, formatChordWords } from "./keys";

import { useHotkeyOverrides } from "./useCommands";

import type { Platform } from "./types";

/**
 * `label(id)`: first chord ("" = unassigned); follows rebinds. Excalidraw's
 * word style by default; pass `formatChord` for the palette's glyphs (⇧⌘P).
 */
export function useCommandShortcutLookup(
  win: Window | null = null,
  format: (chord: string, platform: Platform) => string = formatChordWords,
): (id: string) => string {
  const overrides = useHotkeyOverrides(win);
  const platform = useMemo(() => detectPlatform(win), [win]);
  return useCallback(
    (id: string) => commandShortcutLabel(id, overrides, platform, format),
    [overrides, platform, format],
  );
}

export const useCommandShortcut = (id: string, win?: Window | null): string =>
  useCommandShortcutLookup(win ?? null)(id);
