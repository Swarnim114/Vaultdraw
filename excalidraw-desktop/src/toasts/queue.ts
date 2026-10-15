/**
 * Toast queue: pure state transitions, no timers and no React. The host owns
 * the single timer (see components/Toasts.tsx); callers pass `now`.
 */

export type ToastAction = { label: string; run: () => void };

export type Toast = {
  id: number;
  message: string;
  /** Errors stay a little longer. */
  kind: "info" | "error";
  action?: ToastAction;
  expiresAt: number;
};

export type ToastInput = {
  message: string;
  kind?: Toast["kind"];
  action?: ToastAction;
  /** Overrides the default lifetime. */
  durationMs?: number;
};

export type ToastQueue = { toasts: Toast[]; nextId: number };

export const MAX_VISIBLE = 3;
export const INFO_MS = 5000;
export const ERROR_MS = 8000;
/** A toast with an action (Undo) gives time to reach it. */
export const ACTION_MS = 8000;

export const emptyQueue = (): ToastQueue => ({ toasts: [], nextId: 1 });

const lifetime = (input: ToastInput): number =>
  input.durationMs ??
  (input.action ? ACTION_MS : input.kind === "error" ? ERROR_MS : INFO_MS);

/**
 * Adds a toast. The same message while it is still showing refreshes that
 * toast (new expiry, latest action) instead of stacking a duplicate; beyond
 * MAX_VISIBLE the oldest goes.
 */
export function pushToast(
  queue: ToastQueue,
  input: ToastInput,
  now: number,
): ToastQueue {
  const kind = input.kind ?? "info";
  const expiresAt = now + lifetime(input);
  const same = queue.toasts.find(
    (t) => t.message === input.message && t.kind === kind,
  );
  if (same) {
    return {
      ...queue,
      toasts: queue.toasts.map((t) =>
        t === same ? { ...t, expiresAt, action: input.action } : t,
      ),
    };
  }
  const toast: Toast = {
    id: queue.nextId,
    message: input.message,
    kind,
    action: input.action,
    expiresAt,
  };
  return {
    nextId: queue.nextId + 1,
    toasts: [...queue.toasts, toast].slice(-MAX_VISIBLE),
  };
}

export function dismissToast(queue: ToastQueue, id: number): ToastQueue {
  return queue.toasts.some((t) => t.id === id)
    ? { ...queue, toasts: queue.toasts.filter((t) => t.id !== id) }
    : queue;
}

/** Drops toasts whose time is up. */
export function expireToasts(queue: ToastQueue, now: number): ToastQueue {
  const live = queue.toasts.filter((t) => t.expiresAt > now);
  return live.length === queue.toasts.length
    ? queue
    : { ...queue, toasts: live };
}

/** When the host should next wake up, or null when nothing is showing. */
export function nextExpiry(queue: ToastQueue): number | null {
  return queue.toasts.length === 0
    ? null
    : Math.min(...queue.toasts.map((t) => t.expiresAt));
}
