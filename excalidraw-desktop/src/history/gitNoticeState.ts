/**
 * "Not now" of the git notice, remembered per vault (keyed by vault path) in
 * local storage like the other per-vault UI state (tags pane, links dock).
 */
const KEY = "vaultdraw.historyGitNotice.v1";

type All = Record<string, true>;

const readAll = (win?: Window | null): All => {
  try {
    const raw = (win ?? window).localStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? (parsed as All) : {};
  } catch {
    return {};
  }
};

export const isGitNoticeDismissed = (
  vaultKey: string,
  win?: Window | null,
): boolean => readAll(win)[vaultKey] === true;

/** Silent when storage is unavailable: the notice just comes back next time. */
export function dismissGitNotice(vaultKey: string, win?: Window | null): void {
  try {
    const all = readAll(win);
    all[vaultKey] = true;
    (win ?? window).localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    // not remembered
  }
}
