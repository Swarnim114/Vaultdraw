/**
 * The open drawing's history context, published by HistoryHost while it is
 * mounted so pages that live outside it (Settings > History) can reach the
 * repository and the open drawing without new props on the shared shell.
 * No subscriptions exist until a page reads it, and it holds three references.
 */
import { useSyncExternalStore } from "react";

import type { HistoryRepository } from "./types";

export interface HistoryBridgeValue {
  repository: HistoryRepository;
  handle: string | null;
  /** The open drawing (vault-relative), null = none. */
  path: string | null;
  readOnly: boolean;
}

let current: HistoryBridgeValue | null = null;
const listeners = new Set<() => void>();

export function publishHistoryBridge(value: HistoryBridgeValue | null): void {
  if (
    current &&
    value &&
    current.repository === value.repository &&
    current.handle === value.handle &&
    current.path === value.path &&
    current.readOnly === value.readOnly
  ) {
    return;
  }
  current = value;
  listeners.forEach((l) => l());
}

const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
};

export const useHistoryBridge = (): HistoryBridgeValue | null =>
  useSyncExternalStore(
    subscribe,
    () => current,
    () => null,
  );
