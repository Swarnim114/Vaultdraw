import { getCommonBounds } from "@excalidraw/element";

import { updatePageSetup } from "./data/pageSetup";
import { constrainDragOffset } from "./pageConstraints";

import { API } from "./tests/helpers/api";

const percentile = (sorted: number[], p: number) =>
  sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];

/** µs per call, over `samples` batches of `batch` calls */
const measure = (fn: () => unknown, samples = 50, batch = 2000) => {
  const times: number[] = [];
  for (let s = 0; s < samples; s++) {
    const t0 = performance.now();
    for (let i = 0; i < batch; i++) {
      fn();
    }
    times.push(((performance.now() - t0) * 1000) / batch);
  }
  times.sort((a, b) => a - b);
  return { p50: percentile(times, 0.5), p95: percentile(times, 0.95) };
};

describe("pageConstraints micro-benchmark", () => {
  const setup = updatePageSetup(null, { pageCount: 5 });
  const elements = Array.from({ length: 2000 }, (_, i) =>
    API.createElement({
      type: "rectangle",
      x: (i % 40) * 18,
      y: (i % 50) * 20,
      width: 16,
      height: 16,
    }),
  );
  // the bounds the editor already computes once per move for the selection
  const bounds = getCommonBounds(elements);

  const log = (label: string, r: { p50: number; p95: number }) =>
    // eslint-disable-next-line no-console
    console.log(
      `[bench] ${label}: p50 ${r.p50.toFixed(3)} us/move, p95 ${r.p95.toFixed(
        3,
      )} us/move`,
    );

  it("drag clamp, 2000 elements selected (O(1) on the cached bounds)", () => {
    let n = 0;
    const r = measure(() =>
      constrainDragOffset(setup, bounds, { x: (n++ % 700) - 100, y: n % 900 }),
    );
    log("constrainDragOffset (page mode on, 2000 selected)", r);
    expect(r.p95).toBeLessThan(1000);
  });

  it("drag clamp, nothing selected / page mode off", () => {
    const off = { ...setup, enabled: false };
    const r = measure(() => constrainDragOffset(off, bounds, { x: 5, y: 5 }));
    log("constrainDragOffset (page mode off)", r);
    expect(r.p95).toBeLessThan(1000);
  });

  it("for scale: bounds of 2000 elements (already paid per move today)", () => {
    const r = measure(() => getCommonBounds(elements), 20, 50);
    log("getCommonBounds(2000)", r);
    expect(r.p95).toBeLessThan(50000);
  });
});
