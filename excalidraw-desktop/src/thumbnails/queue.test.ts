import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createInputGate, createJobQueue } from "./queue";

import type { InputGate } from "./queue";

const idle: InputGate = { start() {}, stop() {}, remaining: () => 0 };
const tick = () => new Promise<void>((r) => setTimeout(r, 0));

describe("createJobQueue", () => {
  it("runs visible jobs before near ones, FIFO within a lane", async () => {
    const order: string[] = [];
    const q = createJobQueue({ input: idle, yieldFn: tick });
    const job = (k: string) => async () => {
      order.push(k);
      return k;
    };
    const ps = [
      q.add("first", job("first"), "near"), // starts immediately
      q.add("n1", job("n1"), "near"),
      q.add("v1", job("v1"), "visible"),
      q.add("n2", job("n2"), "near"),
      q.add("v2", job("v2"), "visible"),
    ];
    await Promise.all(ps);
    expect(order).toEqual(["first", "v1", "v2", "n1", "n2"]);
  });

  it("upgrades a queued near job when it is requested as visible", async () => {
    const order: string[] = [];
    const q = createJobQueue({ input: idle, yieldFn: tick });
    const job = (k: string) => async () => void order.push(k);
    const ps = [
      q.add("a", job("a"), "near"),
      q.add("b", job("b"), "near"),
      q.add("c", job("c"), "near"),
      q.add("c", job("c"), "visible"),
    ];
    await Promise.all(ps);
    expect(order).toEqual(["a", "c", "b"]);
  });

  it("cancels queued jobs (waiters get null) but not started ones", async () => {
    const run = vi.fn(async () => "x");
    const q = createJobQueue({ input: idle, yieldFn: tick });
    const a = q.add("a", run);
    const b = q.add("b", run);
    q.cancel("b");
    q.cancel("a");
    expect(await a).toBe("x");
    expect(await b).toBeNull();
    expect(run).toHaveBeenCalledTimes(1);
    expect(q.has("b")).toBe(false);
  });

  it("dedupes by key and returns null for a throwing job", async () => {
    const run = vi.fn(async () => 1);
    const q = createJobQueue({ input: idle, yieldFn: tick });
    const [x, y] = await Promise.all([q.add("k", run), q.add("k", run)]);
    expect([x, y]).toEqual([1, 1]);
    expect(run).toHaveBeenCalledTimes(1);
    expect(
      await q.add("e", async () => {
        throw new Error("no");
      }),
    ).toBeNull();
  });

  it("yields to the event loop between jobs, one job per call", async () => {
    const yieldFn = vi.fn(tick);
    const q = createJobQueue({ input: idle, yieldFn });
    await Promise.all([1, 2, 3].map((n) => q.add(`k${n}`, async () => n)));
    expect(yieldFn).toHaveBeenCalledTimes(2); // none after the last job
  });

  it("holds one colour scope per drain and releases it when empty", async () => {
    const release = vi.fn();
    const scope = vi.fn(async () => release);
    const q = createJobQueue({ input: idle, yieldFn: tick, scope });
    await Promise.all([1, 2, 3].map((n) => q.add(`k${n}`, async () => n)));
    expect(scope).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledTimes(1);
    await q.add("again", async () => 1);
    expect(scope).toHaveBeenCalledTimes(2);
  });

  describe("input pause", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("waits until the user is quiet, releasing the scope meanwhile", async () => {
      let quiet = 120;
      const input: InputGate = {
        start() {},
        stop() {},
        remaining: () => quiet,
      };
      const release = vi.fn();
      const run = vi.fn(async () => "done");
      const q = createJobQueue({
        input,
        scope: async () => release,
        yieldFn: () => Promise.resolve(),
      });
      const p = q.add("a", run);
      await vi.advanceTimersByTimeAsync(50);
      expect(run).not.toHaveBeenCalled();
      quiet = 0;
      await vi.advanceTimersByTimeAsync(100);
      expect(await p).toBe("done");
      expect(run).toHaveBeenCalledTimes(1);
    });

    it("never starves: runs after maxDeferMs of continuous input", async () => {
      const input: InputGate = { start() {}, stop() {}, remaining: () => 100 };
      const run = vi.fn(async () => 1);
      const q = createJobQueue({
        input,
        maxDeferMs: 300,
        yieldFn: () => Promise.resolve(),
      });
      const p = q.add("a", run);
      await vi.advanceTimersByTimeAsync(1000);
      expect(await p).toBe(1);
    });
  });
});

describe("createInputGate", () => {
  it("listens only between start and stop and reports the quiet time", () => {
    const target = new EventTarget();
    const add = vi.spyOn(target, "addEventListener");
    const remove = vi.spyOn(target, "removeEventListener");
    let t = 1000;
    const gate = createInputGate({ target, quietMs: 150, now: () => t });
    expect(add).not.toHaveBeenCalled();
    gate.start();
    expect(add).toHaveBeenCalledTimes(4);
    expect(gate.remaining()).toBe(0);
    target.dispatchEvent(new Event("keydown"));
    t = 1050;
    expect(gate.remaining()).toBe(100);
    t = 1200;
    expect(gate.remaining()).toBe(0);
    gate.stop();
    expect(remove).toHaveBeenCalledTimes(4);
  });
});
