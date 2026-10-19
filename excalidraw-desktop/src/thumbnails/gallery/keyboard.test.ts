import { describe, expect, it } from "vitest";

import { actionForKey, moveIndex, type KeyContext } from "./keyboard";

const c = (over: Partial<KeyContext> = {}): KeyContext => ({
  index: 5,
  count: 10,
  columns: 4,
  pageRows: 2,
  ...over,
});

describe("gallery keyboard", () => {
  it("moves with arrows and hjkl", () => {
    expect(moveIndex("ArrowLeft", c())).toBe(4);
    expect(moveIndex("h", c())).toBe(4);
    expect(moveIndex("ArrowRight", c())).toBe(6);
    expect(moveIndex("l", c())).toBe(6);
    expect(moveIndex("ArrowUp", c())).toBe(1);
    expect(moveIndex("k", c())).toBe(1);
    expect(moveIndex("ArrowDown", c())).toBe(9);
    expect(moveIndex("j", c())).toBe(9);
  });

  it("clamps at the edges", () => {
    expect(moveIndex("h", c({ index: 0 }))).toBe(0);
    expect(moveIndex("l", c({ index: 9 }))).toBe(9);
    expect(moveIndex("k", c({ index: 2 }))).toBe(2);
    expect(moveIndex("j", c({ index: 9 }))).toBe(9);
    // short last row: down from row 1 lands on the last tile
    expect(moveIndex("j", c({ index: 7 }))).toBe(9);
    expect(moveIndex("j", c({ index: 8 }))).toBe(8);
  });

  it("Home/End and paging", () => {
    expect(moveIndex("Home", c())).toBe(0);
    expect(moveIndex("End", c())).toBe(9);
    expect(moveIndex("PageDown", c({ index: 1 }))).toBe(9);
    expect(moveIndex("PageDown", c({ index: 5 }))).toBe(9);
    expect(moveIndex("PageUp", c({ index: 9 }))).toBe(1);
    expect(moveIndex("PageUp", c({ index: 6 }))).toBe(2);
  });

  it("does nothing for no items", () => {
    expect(moveIndex("ArrowRight", c({ count: 0 }))).toBeNull();
    expect(actionForKey({ key: "Enter" }, c({ count: 0 }))).toBeNull();
  });

  it("maps actions and ignores chords", () => {
    expect(actionForKey({ key: "Enter" }, c())).toEqual({ type: "open" });
    expect(actionForKey({ key: "Backspace" }, c())).toEqual({ type: "parent" });
    expect(actionForKey({ key: "Escape" }, c())).toEqual({ type: "close" });
    expect(actionForKey({ key: "l" }, c())).toEqual({ type: "move", index: 6 });
    expect(actionForKey({ key: "l", metaKey: true }, c())).toBeNull();
    expect(actionForKey({ key: "x" }, c())).toBeNull();
  });
});
