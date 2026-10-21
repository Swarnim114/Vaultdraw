/** Keys the OS or the app menu owns: refused on the Hotkeys page. */
import { normalizeChord } from "./keys";

import type { Chord, Platform } from "./types";

const MAC_ONLY: ReadonlyMap<Chord, string> = new Map([
  ["Mod+Tab", "macOS switches applications with this key"],
  ["Mod+Space", "macOS opens Spotlight with this key"],
  ["Mod+Ctrl+Space", "macOS opens the emoji picker with this key"],
  ["Mod+Backquote", "macOS cycles windows with this key"],
  ["Mod+Alt+Escape", "macOS opens Force Quit with this key"],
  ["Mod+Ctrl+Q", "macOS locks the screen with this key"],
  ["Mod+Shift+3", "macOS takes screenshots with this key"],
  ["Mod+Shift+4", "macOS takes screenshots with this key"],
  ["Mod+Shift+5", "macOS takes screenshots with this key"],
  ["Mod+Q", "the app menu quits Vaultdraw with this key"],
  ["Mod+H", "the app menu hides Vaultdraw with this key"],
  ["Mod+Alt+H", "the app menu hides other applications with this key"],
  ["Mod+M", "the app menu minimizes the window with this key"],
  ["Mod+Shift+W", "the app menu closes the window with this key"],
  ["Mod+Ctrl+F", "the app menu toggles full screen with this key"],
]);

const OTHER_ONLY: ReadonlyMap<Chord, string> = new Map([
  ["Alt+F4", "the system closes the window with this key"],
  ["Alt+Tab", "the system switches windows with this key"],
  ["Mod+Alt+Delete", "the system security screen uses this key"],
]);

const TEXT_FIELD: ReadonlyMap<Chord, string> = new Map(
  [
    ["Mod+C", "copy"],
    ["Mod+X", "cut"],
    ["Mod+V", "paste"],
    ["Mod+Z", "undo"],
    ["Mod+A", "select all"],
    ["Mod+Shift+Z", "redo"],
  ].map(([chord, name]) => [chord, `${name} must keep working in text fields`]),
);

/** Why `chord` cannot be assigned, or null when it is allowed. */
export function reservedReason(
  chord: Chord,
  platform: Platform,
): string | null {
  const normalized = normalizeChord(chord, platform);
  const system =
    platform === "mac"
      ? MAC_ONLY.get(normalized)
      : OTHER_ONLY.get(normalized) ??
        (/(^|\+)Meta\+/.test(normalized)
          ? "the Windows/Super key is reserved by the system"
          : undefined);
  return system ?? TEXT_FIELD.get(normalized) ?? null;
}
