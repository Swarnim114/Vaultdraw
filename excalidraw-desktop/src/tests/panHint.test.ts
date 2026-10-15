// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

import { isPanGesture, watchFirstPan } from "../editor/panHint";

describe("isPanGesture", () => {
  const base = { onCanvas: true };
  it("counts plain wheel/trackpad scroll, not zoom", () => {
    expect(isPanGesture({ ...base, type: "wheel" })).toBe(true);
    expect(isPanGesture({ ...base, type: "wheel", ctrlKey: true })).toBe(false);
    expect(isPanGesture({ ...base, type: "wheel", metaKey: true })).toBe(false);
  });
  it("counts middle button, space-drag and the hand tool", () => {
    expect(isPanGesture({ ...base, type: "pointerdown", button: 1 })).toBe(
      true,
    );
    expect(
      isPanGesture({
        ...base,
        type: "pointerdown",
        button: 0,
        spaceHeld: true,
      }),
    ).toBe(true);
    expect(
      isPanGesture({ ...base, type: "pointerdown", button: 0, tool: "hand" }),
    ).toBe(true);
    expect(
      isPanGesture({
        ...base,
        type: "pointerdown",
        button: 0,
        tool: "selection",
      }),
    ).toBe(false);
  });
  it("ignores anything off the canvas", () => {
    expect(isPanGesture({ type: "wheel", onCanvas: false })).toBe(false);
  });
});

describe("watchFirstPan", () => {
  const setup = (tool = "selection") => {
    const host = document.createElement("div");
    const canvas = document.createElement("canvas");
    host.appendChild(canvas);
    document.body.appendChild(host);
    const onPanned = vi.fn();
    watchFirstPan(host, () => tool, onPanned);
    return { canvas, onPanned, host };
  };
  it("fires once on the first wheel scroll, then stops listening", () => {
    const { canvas, onPanned } = setup();
    canvas.dispatchEvent(new WheelEvent("wheel", { bubbles: true }));
    canvas.dispatchEvent(new WheelEvent("wheel", { bubbles: true }));
    expect(onPanned).toHaveBeenCalledTimes(1);
  });
  it("ignores zoom and plain clicks", () => {
    const { canvas, onPanned } = setup();
    canvas.dispatchEvent(
      new WheelEvent("wheel", { bubbles: true, ctrlKey: true }),
    );
    canvas.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    expect(onPanned).not.toHaveBeenCalled();
  });
  it("space then pointerdown pans; space in a text field does not", () => {
    const a = setup();
    a.canvas.dispatchEvent(
      new KeyboardEvent("keydown", { code: "Space", bubbles: true }),
    );
    a.canvas.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    expect(a.onPanned).toHaveBeenCalledTimes(1);

    const b = setup();
    const input = document.createElement("textarea");
    b.host.appendChild(input);
    input.dispatchEvent(
      new KeyboardEvent("keydown", { code: "Space", bubbles: true }),
    );
    b.canvas.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    expect(b.onPanned).not.toHaveBeenCalled();
  });
  it("hand tool pointerdown pans", () => {
    const { canvas, onPanned } = setup("hand");
    canvas.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    expect(onPanned).toHaveBeenCalledTimes(1);
  });
});
