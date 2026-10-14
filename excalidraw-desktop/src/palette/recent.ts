/**
 * Most-recently-used palette entries, one list per mode (files: drawings,
 * commands: items), persisted per window (localStorage). Separate lists keep
 * heavy drawing use from pushing recent commands out, and vice versa.
 */
import type { PaletteMode } from "./rank";

const STORAGE_KEYS: Record<PaletteMode, string> = {
  files: "vaultdraw.palette.recent.files.v1",
  commands: "vaultdraw.palette.recent.commands.v1",
};
/** F41's single mixed list; read as a fallback until a mode has its own. */
const LEGACY_KEY = "vaultdraw.palette.recent.v1";
const MAX_RECENT = 30;

/** Fallback when storage is unavailable (private mode, quota, no window). */
const memory: Record<PaletteMode, string[]> = { files: [], commands: [] };

type MaybeWindow = Window | null | undefined;

const modeOfKey = (key: string): PaletteMode =>
  key.startsWith("drawing:") ? "files" : "commands";

const parse = (raw: string | null): string[] | null => {
  if (raw === null) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((k): k is string => typeof k === "string")
      : [];
  } catch {
    return [];
  }
};

function read(mode: PaletteMode, win: MaybeWindow): string[] {
  try {
    if (!win) {
      return memory[mode];
    }
    const own = parse(win.localStorage.getItem(STORAGE_KEYS[mode]));
    if (own) {
      return own;
    }
    const legacy = parse(win.localStorage.getItem(LEGACY_KEY)) ?? [];
    return legacy.filter((key) => modeOfKey(key) === mode);
  } catch {
    return memory[mode];
  }
}

/** Keys of `mode`, most recent first. */
export function getRecent(mode: PaletteMode, win: MaybeWindow): string[] {
  return read(mode, win).slice(0, MAX_RECENT);
}

/**
 * Move `key` to the front of its mode's list (drawings are "drawing:<path>"
 * and go to files; item keys go to commands).
 */
export function recordRecent(key: string, win: MaybeWindow): void {
  const mode = modeOfKey(key);
  const next = [key, ...read(mode, win).filter((k) => k !== key)].slice(
    0,
    MAX_RECENT,
  );
  try {
    if (!win) {
      throw new Error("no window");
    }
    win.localStorage.setItem(STORAGE_KEYS[mode], JSON.stringify(next));
  } catch {
    memory[mode] = next; // quota or blocked: keep it for this session
  }
}
