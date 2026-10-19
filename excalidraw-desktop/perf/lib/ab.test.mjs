import test from "node:test";
import assert from "node:assert/strict";
import { interleaveOrder, mergeSide, buildAbResult, gateFailures, isWallP95, needsReproduction, reproduced } from "./ab.mjs";

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

test("gateFailures: wall-clock flags block only when quiet and confirmed; CPU time and counts always block", () => {
  const f = [{ metric: "browser.open.small" }, { metric: "browser.cpu.thread" }, { metric: "browser.count.layout" }, { metric: "browser.cpu.task" }];
  const names = (rs) => rs.map((r) => r.metric);
  assert.deepEqual(names(gateFailures(f, { quiet: false, pairs: 3 }).blocking), ["browser.cpu.thread", "browser.count.layout"]);
  assert.deepEqual(names(gateFailures(f, { quiet: true, pairs: 1 }).unconfirmed), ["browser.open.small", "browser.cpu.task"]);
  assert.equal(gateFailures(f, { quiet: true, pairs: 3 }).blocking.length, 4);
});

test("p95 flags must reproduce: only an all-wall-clock-p95 block triggers a second A/B", () => {
  const p95 = (metric) => ({ metric, stat: "p95" });
  const med = (metric) => ({ metric, stat: "median" });
  assert.equal(isWallP95(p95("browser.palette.openFiles")), true);
  assert.equal(isWallP95(med("browser.palette.openFiles")), false);
  assert.equal(isWallP95(p95("browser.cpu.thread")), false);
  assert.equal(needsReproduction([]), false);
  assert.equal(needsReproduction([p95("browser.open.large"), p95("browser.switch.recent")]), true);
  assert.equal(needsReproduction([p95("browser.open.large"), med("browser.palette.openCommands")]), false);
  assert.equal(needsReproduction([p95("browser.open.large"), med("browser.count.layout")]), false);
});

test("reproduced keeps only flags the second A/B shows again (same metric and stat)", () => {
  const first = [{ metric: "browser.open.large", stat: "p95" }, { metric: "browser.palette.openFiles", stat: "p95" }];
  const second = [{ metric: "browser.palette.openFiles", stat: "p95" }, { metric: "browser.open.large", stat: "median" }];
  const r = reproduced(first, second);
  assert.deepEqual(r.blocking.map((x) => x.metric), ["browser.palette.openFiles"]);
  assert.deepEqual(r.cleared.map((x) => x.metric), ["browser.open.large"]);
  assert.deepEqual(reproduced(first, []).blocking, []);
});
