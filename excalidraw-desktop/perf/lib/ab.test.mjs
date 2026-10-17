import test from "node:test";
import assert from "node:assert/strict";
import { interleaveOrder, mergeSide, buildAbResult } from "./ab.mjs";

test("interleaveOrder alternates base/head", () => {
  assert.deepEqual(interleaveOrder(2).map((s) => `${s.side}${s.index}`), ["base0", "head0", "base1", "head1"]);
  assert.deepEqual(interleaveOrder(0), []);
});

const run = (v, start) => ({ raw: { browser: [{ "browser.open.small": [v, v + 2] }] }, load: { start }, errors: [] });

test("mergeSide concatenates per-run samples and aggregates", () => {
  const s = mergeSide([run(100, 4), run(110, 5)]);
  assert.equal(s.raw.length, 2);
  assert.equal(s.metrics["browser.open.small"].runs, 2);
  assert.equal(s.metrics["browser.open.small"].n, 4);
  assert.deepEqual(s.perRunLoad, [4, 5]);
});

test("buildAbResult keeps run.mjs shape and adds ab", () => {
  const head = mergeSide([run(100, 4), run(110, 5)]);
  const base = mergeSide([run(90, 6)]);
  const r = buildAbResult({
    template: { version: 1, mode: "normal", config: { drawingCount: 5000 }, notes: ["browser info: {}", "x"], metrics: {} },
    head, base, baseSha: "abc", pairs: 1, load: { threshold: 3.5, waitedS: 0, quiet: true, start: 1, end: 1 },
  });
  assert.equal(r.version, 1);
  assert.equal(r.config.runs, 2);
  assert.deepEqual(r.raw.browser, head.raw);
  assert.deepEqual(r.notes, ["x"]);
  assert.equal(r.ab.base.sha, "abc");
  assert.deepEqual(r.load.perRun, [4, 5, 6]);
});
