/**
 * Serial render job queue: one job per macrotask, visible jobs before near
 * ones, cancel of queued jobs, one standard-colours scope per drain, and a
 * pause while the user is giving input. Idle = no timers, no listeners.
 */
import type { ColorScope } from "./standardColors";

export type Priority = "visible" | "near";

export interface JobQueue {
  /** Resolves with the job's result, or null when cancelled or failed. */
  add<T>(
    key: string,
    run: () => Promise<T>,
    priority?: Priority,
  ): Promise<T | null>;
  /** Drops a queued job (a started one finishes). */
  cancel(key: string): void;
  has(key: string): boolean;
  size(): number;
}

export const yieldToEventLoop = (): Promise<void> =>
  new Promise((resolve) => {
    const ric = (globalThis as any).requestIdleCallback as
      | ((cb: () => void, opts?: { timeout: number }) => number)
      | undefined;
    if (typeof ric === "function") {
      ric(() => resolve(), { timeout: 50 });
    } else {
      setTimeout(resolve, 0);
    }
  });

const INPUT_EVENTS = [
  "pointerdown",
  "pointermove",
  "keydown",
  "wheel",
] as const;

/** Tracks the last user input; listens only between start() and stop(). */
export interface InputGate {
  start(): void;
  stop(): void;
  /** ms until the user has been quiet for `quietMs` (0 = go ahead). */
  remaining(): number;
}

export const createInputGate = (
  opts: {
    target?: EventTarget | null;
    quietMs?: number;
    now?: () => number;
  } = {},
): InputGate => {
  const target =
    opts.target === undefined
      ? typeof document === "undefined"
        ? null
        : document
      : opts.target;
  const quietMs = opts.quietMs ?? 150;
  const now = opts.now ?? (() => performance.now());
  let last = -Infinity;
  const onInput = () => {
    last = now();
  };
  return {
    start() {
      for (const name of INPUT_EVENTS) {
        target?.addEventListener(name, onInput, {
          capture: true,
          passive: true,
        });
      }
    },
    stop() {
      for (const name of INPUT_EVENTS) {
        target?.removeEventListener(name, onInput, { capture: true });
      }
    },
    remaining: () => Math.max(0, quietMs - (now() - last)),
  };
};

export interface JobQueueOptions {
  /** Held from the first job of a drain until the queue empties or pauses. */
  scope?: ColorScope;
  yieldFn?: () => Promise<void>;
  input?: InputGate;
  /** A job waits at most this long (total) for input to stop. */
  maxDeferMs?: number;
}

type Job = {
  key: string;
  run: () => Promise<unknown>;
  priority: Priority;
  waiters: Array<(v: any) => void>;
};

export const createJobQueue = (opts: JobQueueOptions = {}): JobQueue => {
  const yieldFn = opts.yieldFn ?? yieldToEventLoop;
  const input = opts.input ?? createInputGate();
  const maxDeferMs = opts.maxDeferMs ?? 1000;
  const lanes: Record<Priority, Job[]> = { visible: [], near: [] };
  const queued = new Map<string, Job>();
  const started = new Map<string, Job>();
  let running = false;

  const take = (): Job | undefined => {
    const job = lanes.visible.shift() ?? lanes.near.shift();
    if (job) {
      queued.delete(job.key);
    }
    return job;
  };

  const sleep = (ms: number) =>
    new Promise<void>((resolve) => setTimeout(resolve, ms));

  const pump = async () => {
    if (running) {
      return;
    }
    running = true;
    input.start();
    let release: (() => void) | null = null;
    let deferred = 0;
    try {
      while (queued.size > 0) {
        const wait = input.remaining();
        if (wait > 0 && deferred < maxDeferMs) {
          release?.();
          release = null;
          deferred += wait;
          await sleep(wait);
          continue;
        }
        deferred = 0;
        if (!release && opts.scope) {
          try {
            release = await opts.scope();
          } catch {
            release = () => {};
          }
        }
        const job = take();
        if (!job) {
          break;
        }
        started.set(job.key, job);
        let result: unknown = null;
        try {
          result = await job.run();
        } catch {
          result = null;
        }
        started.delete(job.key);
        job.waiters.forEach((w) => w(result));
        if (queued.size > 0) {
          await yieldFn();
        }
      }
    } finally {
      release?.();
      input.stop();
      running = false;
    }
  };

  return {
    add<T>(key: string, run: () => Promise<T>, priority: Priority = "visible") {
      const existing = queued.get(key) ?? started.get(key);
      if (existing) {
        if (
          queued.has(key) &&
          priority === "visible" &&
          existing.priority === "near"
        ) {
          lanes.near.splice(lanes.near.indexOf(existing), 1);
          existing.priority = "visible";
          lanes.visible.push(existing);
        }
        return new Promise<T | null>((resolve) =>
          existing.waiters.push(resolve),
        );
      }
      return new Promise<T | null>((resolve) => {
        const job: Job = { key, run, priority, waiters: [resolve] };
        queued.set(key, job);
        lanes[priority].push(job);
        void pump();
      });
    },
    cancel(key) {
      const job = queued.get(key);
      if (!job) {
        return;
      }
      queued.delete(key);
      lanes[job.priority].splice(lanes[job.priority].indexOf(job), 1);
      job.waiters.forEach((w) => w(null));
    },
    has: (key) => queued.has(key) || started.has(key),
    size: () => queued.size,
  };
};
