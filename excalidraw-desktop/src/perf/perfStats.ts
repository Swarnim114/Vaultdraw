/** Tiny helpers shared by the perf scenarios. No environment-specific imports. */

/** Collects requestAnimationFrame intervals (ms) until stop() is called. */
export function collectFrames(win: Window): { stop: () => number[] } {
  const intervals: number[] = [];
  let last: number | null = null;
  let running = true;
  const tick = (now: number) => {
    if (!running) {
      return;
    }
    if (last !== null) {
      intervals.push(now - last);
    }
    last = now;
    win.requestAnimationFrame(tick);
  };
  win.requestAnimationFrame(tick);
  return {
    stop: () => {
      running = false;
      return intervals;
    },
  };
}

export const countLong = (intervals: number[], thresholdMs = 50): number =>
  intervals.filter((value) => value > thresholdMs).length;

export const median = (values: number[]): number => {
  if (!values.length) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};
