/** Live shortcut labels for UI that shows a command's current binding. */
import { useCallback, useMemo } from "react";

import { commandShortcutLabel } from "../palette/shortcuts";

import { detectPlatform, formatChordWords } from "./keys";
import { useHotkeyOverrides } from "./useCommands";

/** `label(id)`: first chord in Excalidraw's word style ("" = unassigned); follows rebinds. */
export function useCommandShortcutLookup(
  win: Window | null = null,
): (id: string) => string {
  const overrides = useHotkeyOverrides(win);
  const platform = useMemo(() => detectPlatform(win), [win]);
  return useCallback(
    (id: string) =>
      commandShortcutLabel(id, overrides, platform, formatChordWords),
    [overrides, platform],
  );
}

export const useCommandShortcut = (id: string, win?: Window | null): string =>
  useCommandShortcutLookup(win ?? null)(id);
