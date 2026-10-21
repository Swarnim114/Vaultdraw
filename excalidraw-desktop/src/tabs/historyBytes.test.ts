import { describe, expect, it } from "vitest";

import { estimateHistoryBytes } from "./historyBytes";
import { estimateBytes } from "./tabMemory";

const delta = (i: number) => ({
  elements: {
    added: {},
    removed: {},
    updated: {
      [`el${i}`]: { deleted: { x: i, y: i }, inserted: { x: i + 1, y: i + 2 } },
    },
  },
  appState: { delta: { deleted: {}, inserted: { selectedElementIds: {} } } },
});

describe("estimateHistoryBytes", () => {
  it("matches the plain JSON estimate", () => {
    const snap = {
      undo: Array.from({ length: 10 }, (_, i) => delta(i)),
      redo: [delta(99)],
    };
    const sum =
      snap.undo.reduce((n, d) => n + estimateBytes(d), 0) +
      estimateBytes(snap.redo[0]);
    expect(estimateHistoryBytes(snap)).toBe(sum);
  });

  it("falls back for unknown shapes", () => {
    expect(estimateHistoryBytes({ a: 1 })).toBe(estimateBytes({ a: 1 }));
  });

  it("1,000-delta snapshot: repeat capture is fast (cached)", () => {
    const snap = {
      undo: Array.from({ length: 1000 }, (_, i) => delta(i)),
      redo: [],
    };
    const t0 = performance.now();
    estimateHistoryBytes(snap);
    const first = performance.now() - t0;
    const t1 = performance.now();
    estimateHistoryBytes(snap);
    const again = performance.now() - t1;
    const t2 = performance.now();
    estimateBytes(snap);
    const plain = performance.now() - t2;
    // eslint-disable-next-line no-console
    console.log(
      `estimate 1000 deltas: first ${first.toFixed(
        2,
      )} ms, cached ${again.toFixed(2)} ms, plain stringify ${plain.toFixed(
        2,
      )} ms`,
    );
    expect(again).toBeLessThan(5);
  });
});
