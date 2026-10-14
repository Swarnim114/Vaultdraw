/**
 * Harness-only tracing of every repository (IPC) call: start/end/duration per method, a live
 * `slow-ipc` mark when a call has been pending > 2 s, and a summary for the report.
 * Wraps the repository's own function properties; the app code is untouched.
 */
type Fn = (...args: unknown[]) => Promise<unknown>;

export type IpcTrace = {
  finish: () => { ipcSlow: unknown[]; ipcCounts: Record<string, number> };
  uninstall: () => void;
};

const summarize = (args: unknown[]): string =>
  args
    .map((arg) => {
      if (typeof arg === "string") {
        return arg.length > 120 ? `${arg.slice(0, 117)}...` : arg;
      }
      if (arg && typeof arg === "object" && "path" in arg) {
        return String((arg as { path: unknown }).path);
      }
      return typeof arg;
    })
    .join(", ");

export function installIpcTrace(
  repository: object,
  win: Window & typeof globalThis,
  emit: (name: string, details: Record<string, unknown>) => void,
  slowPendingMs = 2000,
  slowReportMs = 500,
): IpcTrace {
  const now = () => win.performance.now();
  const target = repository as Record<string, unknown>;
  const originals = new Map<string, unknown>();
  const slow: Array<Record<string, unknown>> = [];
  const counts: Record<string, number> = {};
  const pending = new Map<
    number,
    { method: string; args: string; start: number; reported: boolean }
  >();
  let seq = 0;
  let t0: number | null = null;

  const wrap = (method: string, original: unknown) => {
    originals.set(method, original);
    target[method] = (...args: unknown[]) => {
      const start = now();
      if (t0 === null && method === "chooseVault") {
        t0 = start;
      }
      const id = (seq += 1);
      const entry = { method, args: summarize(args), start, reported: false };
      pending.set(id, entry);
      counts[method] = (counts[method] ?? 0) + 1;
      const finish = (ok: boolean) => {
        const duration = now() - start;
        pending.delete(id);
        if (entry.reported) {
          emit("slow-ipc-done", {
            id,
            method,
            durationMs: Math.round(duration),
          });
        }
        if (duration > slowReportMs) {
          slow.push({
            method,
            args: entry.args,
            startMs: Math.round(start - (t0 ?? 0)),
            durationMs: Math.round(duration),
            ok,
          });
        }
      };
      let result: unknown;
      try {
        result = (original as Fn).apply(target, args);
      } catch (error) {
        finish(false);
        throw error;
      }
      return Promise.resolve(result).then(
        (value) => {
          finish(true);
          return value;
        },
        (error: unknown) => {
          finish(false);
          throw error;
        },
      );
    };
  };

  for (const method of Object.keys(target)) {
    const original = target[method];
    if (typeof original === "function") {
      wrap(method, original);
    }
  }

  const timer = win.setInterval(() => {
    const at = now();
    for (const [id, entry] of pending) {
      if (!entry.reported && at - entry.start > slowPendingMs) {
        entry.reported = true;
        emit("slow-ipc", {
          id,
          method: entry.method,
          args: entry.args,
          pendingMs: Math.round(at - entry.start),
          startMs: Math.round(entry.start - (t0 ?? 0)),
        });
      }
    }
  }, 250);

  const uninstall = () => {
    win.clearInterval(timer);
    for (const [method, original] of originals) {
      target[method] = original;
    }
    originals.clear();
  };

  return {
    finish: () => {
      const stillPending = Array.from(pending.values()).map((entry) => ({
        method: entry.method,
        args: entry.args,
        startMs: Math.round(entry.start - (t0 ?? 0)),
        pendingMs: Math.round(now() - entry.start),
      }));
      return {
        ipcSlow: [
          ...slow,
          ...stillPending.map((p) => ({ ...p, pending: true })),
        ],
        ipcCounts: { ...counts },
      };
    },
    uninstall,
  };
}
