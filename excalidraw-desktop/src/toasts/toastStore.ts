import { dismissToast, emptyQueue, expireToasts, pushToast } from "./queue";

import type { Toast, ToastInput, ToastQueue } from "./queue";

type Listener = () => void;

/** Tiny external store: callers anywhere push, only the host subscribes, so the app tree never re-renders for a toast. */
export function createToastStore(now: () => number = Date.now) {
  let queue: ToastQueue = emptyQueue();
  const listeners = new Set<Listener>();
  const set = (next: ToastQueue) => {
    if (next !== queue) {
      queue = next;
      listeners.forEach((l) => l());
    }
  };
  return {
    push: (input: ToastInput) => set(pushToast(queue, input, now())),
    dismiss: (id: number) => set(dismissToast(queue, id)),
    expire: () => set(expireToasts(queue, now())),
    clear: () => set(emptyQueue()),
    getSnapshot: (): ToastQueue => queue,
    subscribe: (listener: Listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    now,
  };
}

export type ToastStore = ReturnType<typeof createToastStore>;
export type { Toast };

/** The app's one store. */
export const toastStore = createToastStore();
