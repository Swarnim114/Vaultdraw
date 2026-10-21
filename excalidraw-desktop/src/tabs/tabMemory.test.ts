import { describe, expect, it } from "vitest";

import { estimateBytes, TabMemory } from "./tabMemory";

const mk = (budget: number, pinned: string[] = []) =>
  new TabMemory<string>({
    budgetBytes: budget,
    isPinned: (id) => pinned.includes(id),
  });
const e = (path: string, bytes: number, revision: number | string = 1) => ({
  path,
  revision,
  snapshot: `snap:${path}`,
  bytes,
});

describe("TabMemory", () => {
  it("stores and takes a matching entry once", () => {
    const m = mk(100);
    m.put("t1", e("a.excalidraw", 10));
    expect(m.totalBytes).toBe(10);
    expect(m.take("t1", "a.excalidraw", 1)).toBe("snap:a.excalidraw");
    expect(m.size).toBe(0);
    expect(m.take("t1", "a.excalidraw", 1)).toBeNull();
  });

  it("evicts least recently put first", () => {
    const m = mk(25);
    m.put("t1", e("a", 10));
    m.put("t2", e("b", 10));
    m.put("t3", e("c", 10));
    expect(m.has("t1")).toBe(false);
    expect(m.has("t2") && m.has("t3")).toBe(true);
    expect(m.totalBytes).toBe(20);
  });

  it("touch protects an entry from eviction", () => {
    const m = mk(25);
    m.put("t1", e("a", 10));
    m.put("t2", e("b", 10));
    m.touch("t1");
    m.put("t3", e("c", 10));
    expect(m.has("t1")).toBe(true);
    expect(m.has("t2")).toBe(false);
  });

  it("evicts unpinned before pinned", () => {
    const m = mk(25, ["t1"]);
    m.put("t1", e("a", 10));
    m.put("t2", e("b", 10));
    m.put("t3", e("c", 10));
    expect(m.has("t1")).toBe(true);
    expect(m.has("t2")).toBe(false);
    expect(m.has("t3")).toBe(true);
  });

  it("evicts pinned when only pinned remain over budget", () => {
    const m = mk(15, ["t1", "t2"]);
    m.put("t1", e("a", 10));
    m.put("t2", e("b", 10));
    expect(m.has("t1")).toBe(false);
    expect(m.has("t2")).toBe(true);
  });

  it("does not keep an entry larger than the whole budget", () => {
    const m = mk(10);
    m.put("t1", e("a", 5));
    m.put("t2", e("b", 11));
    expect(m.has("t2")).toBe(false);
    expect(m.has("t1")).toBe(true);
    m.put("t1", e("a", 50)); // oversize replacement also clears the old one
    expect(m.size).toBe(0);
    expect(m.totalBytes).toBe(0);
  });

  it("budget 0 keeps nothing", () => {
    const m = mk(0);
    m.put("t1", e("a", 0));
    m.put("t2", e("b", 1));
    expect(m.size).toBe(0);
  });

  it("put replaces an existing entry and fixes the total", () => {
    const m = mk(100);
    m.put("t1", e("a", 10));
    m.put("t1", e("a", 30));
    expect(m.totalBytes).toBe(30);
    expect(m.size).toBe(1);
  });

  it("take with a mismatched revision or path drops the entry", () => {
    const m = mk(100);
    m.put("t1", e("a", 10, 1));
    expect(m.take("t1", "a", 2)).toBeNull();
    expect(m.size).toBe(0);
    m.put("t1", e("a", 10, 1));
    expect(m.take("t1", "b", 1)).toBeNull();
    expect(m.size).toBe(0);
    expect(m.totalBytes).toBe(0);
  });

  it("supports string revisions", () => {
    const m = mk(100);
    m.put("t1", e("a", 10, "h1"));
    expect(m.take("t1", "a", "h1")).not.toBeNull();
  });

  it("renamePath uses folder-prefix semantics", () => {
    const m = mk(1000);
    m.put("t1", e("a/b", 1));
    m.put("t2", e("a/b/x", 1));
    m.put("t3", e("a/bc", 1));
    m.renamePath("a/b", "z");
    expect(m.take("t1", "z", 1)).not.toBeNull();
    expect(m.take("t2", "z/x", 1)).not.toBeNull();
    expect(m.take("t3", "a/bc", 1)).not.toBeNull();
  });

  it("setBudget shrinks by eviction and 0 clears", () => {
    const m = mk(100);
    m.put("t1", e("a", 40));
    m.put("t2", e("b", 40));
    m.setBudget(50);
    expect(m.has("t1")).toBe(false);
    expect(m.has("t2")).toBe(true);
    m.setBudget(0);
    expect(m.size).toBe(0);
    m.put("t3", e("c", 1));
    expect(m.size).toBe(0);
  });

  it("delete and clear update totals", () => {
    const m = mk(100);
    m.put("t1", e("a", 10));
    m.put("t2", e("b", 10));
    m.delete("t1");
    expect(m.totalBytes).toBe(10);
    m.clear();
    expect(m.totalBytes).toBe(0);
    expect(m.size).toBe(0);
  });
});

describe("estimateBytes", () => {
  it("is JSON length times two", () => {
    expect(estimateBytes("ab")).toBe(8); // "ab" = 4 chars
    expect(estimateBytes({ a: 1 })).toBe(14);
    expect(estimateBytes([])).toBe(4);
  });

  it("handles undefined and unserializable values", () => {
    expect(estimateBytes(undefined)).toBe(0);
    const c: Record<string, unknown> = {};
    c.self = c;
    expect(estimateBytes(c)).toBe(0);
  });

  it("benchmark: ~1,000 small objects", () => {
    const arr = Array.from({ length: 1000 }, (_, i) => ({
      type: "rectangle",
      id: `id${i}`,
      x: i,
      y: i * 2,
      width: 10,
      height: 20,
    }));
    const t0 = performance.now();
    const n = estimateBytes(arr);
    const ms = performance.now() - t0;
    // eslint-disable-next-line no-console
    console.log(
      `estimateBytes(1000 objects) = ${n} bytes in ${ms.toFixed(3)} ms`,
    );
    expect(n).toBeGreaterThan(50_000);
  });
});
