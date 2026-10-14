/** Most-recently-used palette entries, persisted per window (localStorage). */

const STORAGE_KEY = "vaultdraw.palette.recent.v1";
const MAX_RECENT = 30;

/** Fallback when storage is unavailable (private mode, quota, no window). */
let memory: string[] = [];

type MaybeWindow = Window | null | undefined;

function read(win: MaybeWindow): string[] {
  let raw: string | null;
  try {
    if (!win) {
      return memory;
    }
    raw = win.localStorage.getItem(STORAGE_KEY);
  } catch {
    return memory;
  }
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.filter((k): k is string => typeof k === "string")
      : [];
  } catch {
    return [];
  }
}

/** Keys, most recent first. */
export function getRecent(win: MaybeWindow): string[] {
  return read(win).slice(0, MAX_RECENT);
}

/** Move `key` to the front (drawings are "drawing:<path>", items their key). */
export function recordRecent(key: string, win: MaybeWindow): void {
  const next = [key, ...read(win).filter((k) => k !== key)].slice(
    0,
    MAX_RECENT,
  );
  try {
    if (!win) {
      throw new Error("no window");
    }
    win.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    memory = next; // quota or blocked: keep it for this session
  }
}
