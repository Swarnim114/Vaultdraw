import { describe, expect, it } from "vitest";

import { NavHistory } from "./history";

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
