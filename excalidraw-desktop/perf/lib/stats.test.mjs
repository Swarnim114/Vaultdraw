import test from "node:test";
import assert from "node:assert/strict";
import { median, percentile, max, mean, stdev, cv, aggregate } from "./stats.mjs";

test("basic stats", () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([1, 2, 3, 4]), 2.5);
  assert.equal(max([1, 9, 3]), 9);
  assert.equal(mean([1, 2, 3]), 2);
  assert.ok(Math.abs(stdev([2, 4, 4, 4, 5, 5, 7, 9]) - 2.138) < 0.001);
  assert.equal(cv([5]), 0);
  assert.equal(cv([0, 0]), 0);
});

test("percentile interpolates linearly", () => {
  const xs = Array.from({ length: 101 }, (_, i) => i);
  assert.equal(percentile(xs, 95), 95);
  assert.equal(percentile([0, 10], 95), 9.5);
  assert.equal(percentile([7], 95), 7);
});

test("aggregate", () => {
  const m = aggregate([{ a: [10, 10, 10], b: [1] }, { a: [10, 10, 20], b: [1] }, { a: [10, 10, 10] }], () => "ms");
  assert.equal(m.a.n, 9);
  assert.equal(m.a.runs, 3);
  assert.deepEqual(m.a.perRunMedians, [10, 10, 10]);
  assert.equal(m.a.cv, 0);
  assert.equal(m.a.noisy, false);
  assert.equal(m.b.runs, 2);
  const n = aggregate([{ a: [100] }, { a: [120] }]);
  assert.equal(n.a.noisy, true);
});
