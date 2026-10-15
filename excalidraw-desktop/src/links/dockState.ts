/** Links dock visibility, kept in local UI state like the other navigator state. */
const KEY = "vaultdraw.linksDock";

export function getDockVisible(win?: Window | null): boolean {
  try {
    return (win ?? window).localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function setDockVisible(visible: boolean, win?: Window | null): void {
  try {
    (win ?? window).localStorage.setItem(KEY, visible ? "1" : "0");
  } catch {
    // Storage unavailable: the toggle simply is not remembered.
  }
}
