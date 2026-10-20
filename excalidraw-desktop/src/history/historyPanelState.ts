/**
 * Whether the History panel is showing, published by HistoryHost so entry
 * points outside it (the header button, "History" in a row menu) can show a
 * pressed state or avoid toggling an open panel shut. One boolean; listeners
 * run only when it flips.
 */
import { useSyncExternalStore } from "react";

let open = false;
const listeners = new Set<() => void>();

export function publishHistoryPanelOpen(value: boolean): void {
  if (open !== value) {
    open = value;
    listeners.forEach((l) => l());
  }
}

export const isHistoryPanelOpen = (): boolean => open;

const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
};

export const useHistoryPanelOpen = (): boolean =>
  useSyncExternalStore(subscribe, isHistoryPanelOpen, () => false);
