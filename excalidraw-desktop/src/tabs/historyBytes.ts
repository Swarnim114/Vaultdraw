/**
 * Tabs (F5): cheap size estimate for a history snapshot. Deltas are immutable
 * once recorded, so each delta is measured once (WeakMap) and a repeated
 * capture of a long stack only measures the deltas added since.
 */
import { estimateBytes } from "./tabMemory";

const cache = new WeakMap<object, number>();

const sizeOf = (delta: unknown): number => {
  if (typeof delta !== "object" || delta === null) {
    return estimateBytes(delta);
  }
  let size = cache.get(delta);
  if (size === undefined) {
    size = estimateBytes(delta);
    cache.set(delta, size);
  }
  return size;
};

export const estimateHistoryBytes = (snapshot: unknown): number => {
  const s = snapshot as { undo?: unknown[]; redo?: unknown[] } | null;
  if (!s || !Array.isArray(s.undo) || !Array.isArray(s.redo)) {
    return estimateBytes(snapshot);
  }
  let total = 0;
  for (const d of s.undo) {
    total += sizeOf(d);
  }
  for (const d of s.redo) {
    total += sizeOf(d);
  }
  return total;
};
