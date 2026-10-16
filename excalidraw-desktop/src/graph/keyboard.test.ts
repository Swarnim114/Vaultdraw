import { describe, expect, it } from "vitest";

import { actionForKey, GRAPH_KEYS, selectInDirection } from "./keyboard";

describe("key table", () => {
  it("maps the Vim keys", () => {
    expect(actionForKey({ key: "h" })).toEqual({ type: "move", dir: "left" });
    expect(actionForKey({ key: "ArrowDown" })).toEqual({
      type: "move",
      dir: "down",
    });
    expect(actionForKey({ key: "L" })).toEqual({ type: "toggleLocal" });
    expect(actionForKey({ key: "l" })).toEqual({ type: "move", dir: "right" });
    expect(actionForKey({ key: "2" })).toEqual({ type: "depth", depth: 2 });
    expect(actionForKey({ key: "F" })).toEqual({ type: "hints" });
    expect(actionForKey({ key: "f" })).toEqual({ type: "hints" });
    expect(actionForKey({ key: "Escape" })).toEqual({ type: "close" });
    expect(actionForKey({ key: "0" })).toEqual({ type: "fit" });
    expect(actionForKey({ key: "q" })).toBeNull();
  });

  it("leaves app chords alone and accepts a replacement table", () => {
    expect(actionForKey({ key: "h", metaKey: true })).toBeNull();
    expect(actionForKey({ key: "k", ctrlKey: true })).toBeNull();
    expect(
      actionForKey({ key: "x" }, { ...GRAPH_KEYS, x: { type: "fit" } }),
    ).toEqual({
      type: "fit",
    });
    expect(actionForKey({ key: "toString" })).toBeNull();
  });
});

// 0 centre, 1 right, 2 far right, 3 up, 4 down-left
const pos = Float32Array.from([0, 0, 10, 0, 40, 2, 0, -10, -8, 9]);
const centre = { x: 0, y: 0 };

describe("selectInDirection", () => {
  it("prefers a neighbour in that direction", () => {
    expect(selectInDirection(pos, 5, 0, "right", [1, 2], null, centre)).toBe(1);
    expect(selectInDirection(pos, 5, 0, "up", [1, 3], null, centre)).toBe(3);
    expect(selectInDirection(pos, 5, 0, "down", [1, 4], null, centre)).toBe(4);
  });

  it("falls back to any visible node that way, then to the nearest", () => {
    expect(selectInDirection(pos, 5, 0, "right", [3], null, centre)).toBe(1);
    expect(selectInDirection(pos, 5, 2, "right", [], null, centre)).toBe(1); // nothing right of 2: nearest
  });

  it("skips hidden nodes and returns -1 when alone", () => {
    const hidden = Uint8Array.from([0, 1, 0, 0, 0]);
    expect(selectInDirection(pos, 5, 0, "right", [1], hidden, centre)).toBe(2);
    expect(selectInDirection(pos, 1, 0, "right", [], null, centre)).toBe(-1);
  });

  it("with no focus picks the node nearest the centre", () => {
    expect(
      selectInDirection(pos, 5, -1, "right", [], null, { x: 38, y: 2 }),
    ).toBe(2);
  });
});
