/**
 * Tags pane UI state per vault, in local storage like the Links dock's:
 * sort override, section open/closed and collapsed node keys. One entry
 * holds every vault, keyed by the vault's path.
 */
import type { TagSort } from "./types";

const KEY = "vaultdraw.tagsPane.v1";

export type TagPaneState = {
  sort?: TagSort;
  open?: boolean;
  collapsed?: string[];
};

type All = Record<string, TagPaneState>;

const readAll = (win?: Window | null): All => {
  try {
    const raw = (win ?? window).localStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? (parsed as All) : {};
  } catch {
    return {};
  }
};

export function loadPaneState(
  vaultKey: string,
  win?: Window | null,
): TagPaneState {
  const s = readAll(win)[vaultKey];
  if (!s || typeof s !== "object") {
    return {};
  }
  return {
    sort: s.sort === "name" || s.sort === "count" ? s.sort : undefined,
    open: typeof s.open === "boolean" ? s.open : undefined,
    collapsed: Array.isArray(s.collapsed)
      ? s.collapsed.filter((k): k is string => typeof k === "string")
      : undefined,
  };
}

/** Merge `patch` into the vault's state. Silent when storage is unavailable. */
export function savePaneState(
  vaultKey: string,
  patch: TagPaneState,
  win?: Window | null,
): void {
  try {
    const all = readAll(win);
    all[vaultKey] = { ...all[vaultKey], ...patch };
    (win ?? window).localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    // Storage unavailable: the choice is simply not remembered.
  }
}
