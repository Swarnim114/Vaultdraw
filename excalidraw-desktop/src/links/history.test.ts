import { describe, expect, it } from "vitest";

import { NavHistories, NavHistory } from "./history";

describe("NavHistory", () => {
  it("goes back and forward and drops the forward branch on a new visit", () => {
    const h = new NavHistory();
    h.visit({ path: "a" });
    h.visit({ path: "b", elementId: "1" });
    h.visit({ path: "c" });
    expect(h.back()).toEqual({ path: "b", elementId: "1" });
    expect(h.back()).toEqual({ path: "a" });
    expect(h.back()).toBeNull();
    expect(h.forward()).toEqual({ path: "b", elementId: "1" });
    h.visit({ path: "d" });
    expect(h.canForward).toBe(false);
    expect(h.back()).toEqual({ path: "b", elementId: "1" });
  });
  it("ignores the visit that follows back()", () => {
    const h = new NavHistory();
    h.visit({ path: "a" });
    h.visit({ path: "b" });
    const e = h.back()!;
    h.visit(e);
    expect(h.canForward).toBe(true);
    expect(h.current).toEqual({ path: "a" });
  });
  it("is capped", () => {
    const h = new NavHistory(3);
    for (const p of "abcde") {
      h.visit({ path: p });
    }
    expect(h.back()?.path).toBe("d");
    expect(h.back()?.path).toBe("c");
    expect(h.back()).toBeNull();
  });
  it("follows renames, folders included", () => {
    const h = new NavHistory();
    h.visit({ path: "f/a.excalidraw" });
    h.visit({ path: "z.excalidraw" });
    h.rename("f", "g");
    expect(h.back()?.path).toBe("g/a.excalidraw");
  });
});

describe("NavHistories", () => {
  it("keeps one history per tab; back in one does not affect the other", () => {
    const hs = new NavHistories();
    const a = hs.for("t1");
    const b = hs.for("t2");
    a.visit({ path: "x" });
    a.visit({ path: "y" });
    b.visit({ path: "z" });
    expect(hs.for("t1")).toBe(a);
    expect(a.back()).toEqual({ path: "x" });
    expect(b.canBack).toBe(false);
    expect(b.current).toEqual({ path: "z" });
  });

  it("shares one history without a tab id", () => {
    const hs = new NavHistories();
    expect(hs.for(null)).toBe(hs.for(undefined));
    expect(hs.for(null)).not.toBe(hs.for("t1"));
  });

  it("rename applies to every history", () => {
    const hs = new NavHistories();
    hs.for("t1").visit({ path: "dir/a" });
    hs.for("t2").visit({ path: "dir/a" });
    hs.for(null).visit({ path: "dir/a" });
    hs.rename("dir", "moved");
    for (const id of ["t1", "t2", null]) {
      expect(hs.for(id).current).toEqual({ path: "moved/a" });
    }
  });

  it("prune drops histories of closed tabs only", () => {
    const hs = new NavHistories();
    const keep = hs.for("t1");
    hs.for("t2");
    hs.prune(new Set(["t1"]));
    expect(hs.size).toBe(1);
    expect(hs.for("t1")).toBe(keep);
  });
});
