/**
 * Registry of cheap-to-rebuild caches that can be dropped to give memory back.
 * A purge never touches document state; it only discards data that is rebuilt on demand.
 */

export type PurgeReason = "hidden" | "idle" | "pressure" | "manual";

export interface PurgeOptions {
  /**
   * "offscreen": safe while the window is visible (nothing the canvas draws right now).
   * "all": may force a repaint-from-scratch of visible content, so it only runs when the
   * window is hidden, the system is under pressure, or the user asked for it.
   */
  scope: "offscreen" | "all";
}

type Purge = () => void | Promise<void>;

const purges = new Map<string, { fn: Purge } & PurgeOptions>();

/** Register (or replace) a purge. Returns an unregister function. */
export function registerPurge(
  name: string,
  fn: Purge,
  options: PurgeOptions = { scope: "all" },
): () => void {
  const entry = { fn, ...options };
  purges.set(name, entry);
  return () => {
    if (purges.get(name) === entry) {
      purges.delete(name);
    }
  };
}

/** Whether a purge registered with `scope` may run for `reason`. */
const allowed = (reason: PurgeReason, scope: PurgeOptions["scope"]) =>
  scope === "offscreen" || reason !== "idle";

/** Run every purge allowed for `reason`. A failing purge never stops the others. */
export async function purgeAll(reason: PurgeReason): Promise<string[]> {
  const ran: string[] = [];
  for (const [name, { fn, scope }] of purges) {
    if (!allowed(reason, scope)) {
      continue;
    }
    try {
      await fn();
      ran.push(name);
    } catch {
      // A cache that fails to clear is still rebuildable; keep going.
    }
  }
  return ran;
}
