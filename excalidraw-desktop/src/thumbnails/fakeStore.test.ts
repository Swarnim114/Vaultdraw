import { describe, expect, it } from "vitest";

import { createFakeThumbnailStore } from "./fakeStore";

const png = () =>
  new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" });

describe("fake thumbnail store", () => {
  const revs: Record<string, string | null> = { a: "r1", b: "r2", gone: null };
  const make = (extra = {}) =>
    createFakeThumbnailStore({
      revisionOf: (_h, p) => revs[p] ?? null,
      ...extra,
    });

  it("reports miss, then hit after put, and missing for unknown files", async () => {
    const s = make();
    let r = await s.lookup("h", ["a", "gone"], 1);
    expect(r.items).toEqual([
      { rev: "r1", state: "miss" },
      { rev: null, state: "missing" },
    ]);
    const url = await s.put("h", "a", "r1", png(), 1);
    expect(url).toBeTruthy();
    r = await s.lookup("h", ["a"], 1);
    expect(r.items[0]).toEqual({ rev: "r1", state: "hit" });
    expect(s.urlFor(r.vaultId, "r1")).toBe(url);
  });

  it("fail markers are per render version", async () => {
    const s = make();
    expect(await s.put("h", "b", "r2", null, 1)).toBeNull();
    expect((await s.lookup("h", ["b"], 1)).items[0].state).toBe("failed");
    expect((await s.lookup("h", ["b"], 2)).items[0].state).toBe("miss");
  });

  it("counts calls, answers pending when asked, and clears", async () => {
    const s = make({ pendingLookups: 1 });
    expect((await s.lookup("h", ["a"], 1)).items[0].state).toBe("pending");
    await s.lookup("h", ["a", "b"], 1);
    await s.put("h", "a", "r1", png(), 1);
    expect(s.calls.lookup).toBe(2);
    expect(s.calls.put).toBe(1);
    expect(s.calls.lookupPaths).toEqual([["a"], ["a", "b"]]);
    await s.clear("h");
    expect(s.size()).toBe(0);
    expect(s.calls.clear).toBe(1);
  });
});
