import { purgeAll, type PurgeReason } from "./purgeRegistry";

/**
 * Hidden this long (window minimised / app hidden) before purging everything. Long enough
 * that a quick look at another window never pays a full re-raster when coming back.
 */
export const HIDDEN_PURGE_DELAY_MS = 2 * 60_000;
/** No input for this long while visible before purging off-screen caches. */
export const IDLE_PURGE_DELAY_MS = 3 * 60_000;

const INPUT_EVENTS = [
  "pointerdown",
  "pointermove",
  "keydown",
  "wheel",
] as const;

export interface TriggerDeps {
  win: Window;
  /** Ask the native side to hand freed pages back to the OS. */
  releaseNative: () => Promise<void> | void;
  /** Subscribe to native memory-pressure events; returns an unsubscribe function. */
  onPressure: (handler: () => void) => () => void;
}

/** Wire the purge triggers; returns a disposer. No polling: only timers and listeners. */
export function installPurgeTriggers({
  win,
  releaseNative,
  onPressure,
}: TriggerDeps): () => void {
  const doc = win.document;
  let hiddenTimer: number | undefined;
  let idleTimer: number | undefined;
  let lastInput = Date.now();
  let idlePurged = false;

  const run = async (reason: PurgeReason) => {
    await purgeAll(reason);
    try {
      await releaseNative();
    } catch {
      // Native relief is best effort.
    }
  };

  const armIdle = (delay: number) => {
    win.clearTimeout(idleTimer);
    idleTimer = win.setTimeout(onIdleTimer, delay);
  };
  // A single timer that re-arms for the remainder: input handlers only store a timestamp.
  function onIdleTimer() {
    const remaining = IDLE_PURGE_DELAY_MS - (Date.now() - lastInput);
    if (remaining > 0) {
      armIdle(remaining);
      return;
    }
    if (doc.visibilityState === "visible" && !idlePurged) {
      idlePurged = true;
      void run("idle");
    }
  }
  const onInput = () => {
    lastInput = Date.now();
    if (idlePurged) {
      idlePurged = false;
      armIdle(IDLE_PURGE_DELAY_MS);
    }
  };
  const onVisibility = () => {
    win.clearTimeout(hiddenTimer);
    if (doc.visibilityState === "hidden") {
      hiddenTimer = win.setTimeout(() => {
        if (doc.visibilityState === "hidden") {
          void run("hidden");
        }
      }, HIDDEN_PURGE_DELAY_MS);
    } else {
      onInput();
    }
  };

  for (const type of INPUT_EVENTS) {
    win.addEventListener(type, onInput, { capture: true, passive: true });
  }
  doc.addEventListener("visibilitychange", onVisibility);
  armIdle(IDLE_PURGE_DELAY_MS);
  const offPressure = onPressure(() => void run("pressure"));
  if (doc.visibilityState === "hidden") {
    onVisibility();
  }

  return () => {
    win.clearTimeout(hiddenTimer);
    win.clearTimeout(idleTimer);
    for (const type of INPUT_EVENTS) {
      win.removeEventListener(type, onInput, { capture: true });
    }
    doc.removeEventListener("visibilitychange", onVisibility);
    offPressure();
  };
}

/** Run a purge on demand (the "Free memory" action). */
export const purgeNow = (releaseNative: TriggerDeps["releaseNative"]) =>
  purgeAll("manual").then(() => releaseNative());
