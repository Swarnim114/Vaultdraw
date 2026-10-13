import test from "node:test";
import assert from "node:assert/strict";
import { compare, pickBaseline } from "./compare.mjs";
import { loadCatalogue } from "./catalogue.mjs";

const cat = loadCatalogue();
const m = (o) => ({ metrics: o });
const mk = (median, p95 = median, extra = {}) => ({ unit: "ms", median, p95, max: p95, cv: 0, noisy: false, ...extra });
const row = (r, metric, stat) => r.rows.find((x) => x.metric === metric && x.stat === stat);

test("5% boundary: exactly 5% passes, above fails", () => {
  const base = m({ "save.medium": mk(100) });
  assert.equal(row(compare(m({ "save.medium": mk(105) }), base, cat), "save.medium", "median").status, "ok");
  const r = compare(m({ "save.medium": mk(106) }), base, cat);
  assert.equal(row(r, "save.medium", "median").status, "regressed");
  assert.equal(r.exitCode, 1);
});

test("absolute slack: +0.8 ms on 10 ms (8%) is ignored, +1.5 ms is not", () => {
  const base = m({ "save.medium": mk(10) });
  assert.equal(row(compare(m({ "save.medium": mk(10.8) }), base, cat), "save.medium", "median").status, "ok");
  assert.equal(row(compare(m({ "save.medium": mk(11.5) }), base, cat), "save.medium", "median").status, "regressed");
});

test("noisy widening: +20% passes with CV 15%, flagged noisy-ok", () => {
  const base = m({ "save.medium": mk(100, 100, { cv: 0.15, noisy: true }) });
  const r = compare(m({ "save.medium": mk(120) }), base, cat);
  const x = row(r, "save.medium", "median");
  assert.equal(x.status, "noisy-ok");
  assert.ok(x.threshold >= 30 - 1e-9);
  assert.equal(r.exitCode, 0);
  assert.equal(row(compare(m({ "save.medium": mk(140) }), base, cat), "save.medium", "median").status, "regressed");
});

test("frame metrics gate p95 only; longFrames median with zero slack", () => {
  const base = m({ "pan.frame": mk(16.7, 20), "typing.longFrames": { unit: "count", median: 0, p95: 0, max: 0, cv: 0, noisy: false } });
  const r = compare(m({ "pan.frame": mk(30, 20.5), "typing.longFrames": { unit: "count", median: 1, p95: 1, max: 1, cv: 0, noisy: false } }), base, cat);
  assert.equal(r.rows.filter((x) => x.metric === "pan.frame").length, 1);
  assert.equal(row(r, "pan.frame", "p95").status, "ok");
  assert.equal(row(r, "typing.longFrames", "median").status, "regressed");
});

test("budget breach fails when baseline met it; pre-existing is a warning", () => {
  const good = m({ "search.keystroke": mk(10, 40) });
  const bad = m({ "search.keystroke": mk(10, 60) });
  const fail = compare(bad, good, cat);
  assert.equal(fail.exitCode, 1);
  assert.ok(fail.rows.some((x) => x.status === "budget"));
  const pre = compare(m({ "search.keystroke": mk(10, 60) }), m({ "search.keystroke": mk(10, 59) }), cat);
  assert.ok(pre.rows.some((x) => x.status === "budget-preexisting"));
  assert.equal(pre.exitCode, 0);
  // no baseline value: new + breach fails
  assert.equal(compare(bad, m({}), cat).exitCode, 1);
});

test("open.large has no budget; browser.<id> inherits spec; missing/new", () => {
  const r = compare(m({ "open.large": mk(5000), "browser.open.small": mk(400) }), m({ "open.large": mk(5000), "save.large": mk(1) }), cat);
  assert.equal(r.exitCode, 1); // browser.open.small budget breach (no baseline)
  assert.ok(r.rows.some((x) => x.metric === "browser.open.small" && x.status === "new"));
  assert.ok(r.rows.some((x) => x.metric === "save.large" && x.status === "missing"));
  assert.ok(!r.rows.some((x) => x.metric === "open.large" && x.status !== "ok"));
});

test("combined baseline picks the matching mode; warns on machine mismatch", () => {
  const normal = { mode: "normal", metrics: {} };
  const low = { mode: "low-end", metrics: {} };
  const file = { machine: { brand: "M1", memBytes: 1 }, modes: { normal, "low-end": low } };
  assert.equal(pickBaseline(file, "low-end", { brand: "M1", memBytes: 1 }).baseline, low);
  const p = pickBaseline(file, "normal", { brand: "M4", memBytes: 2 });
  assert.equal(p.baseline, normal);
  assert.equal(p.warnings.length, 1);
  assert.equal(pickBaseline({ modes: { normal } }, "low-end").baseline, null);
  assert.equal(pickBaseline(normal, "low-end").warnings.length, 1);
});
