/** Shortcut labels for palette rows: one look for app and editor commands. */
import { getCommand } from "../commands/commands";
import { formatChord, normalizeChord, parseChord } from "../commands/keys";
import { effectiveKeys } from "../commands/keymap";

import type { HotkeyOverrides, Platform } from "../commands/types";

/** First effective chord of a registry command (rebinds included); "" = none. */
export function commandShortcutLabel(
  id: string,
  overrides: HotkeyOverrides,
  platform: Platform,
): string {
  const command = getCommand(id);
  const first = command && effectiveKeys(command, overrides, platform)[0];
  return first ? formatChord(first, platform) : "";
}

/** Excalidraw prints "Option"/"Opt" for Alt on macOS; parseChord wants Alt. */
const OPTION = /\b(?:Option|Opt)\b/gi;

/**
 * Excalidraw's display shortcut ("Cmd+Shift+L", "Shift+Alt+D", "R") in our
 * notation ("⇧⌘L"); the raw text when it does not parse (e.g. "Space+drag").
 */
export function excalidrawShortcutLabel(
  raw: string | null | undefined,
  platform: Platform,
): string {
  if (!raw) {
    return "";
  }
  const chord = parseChord(raw.replace(OPTION, "Alt"));
  return chord ? formatChord(normalizeChord(chord, platform), platform) : raw;
}
