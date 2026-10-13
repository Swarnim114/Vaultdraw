// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  applyWebviewZoom,
  clampZoom,
  installZoomShortcuts,
  resetWebviewZoomState,
  stepZoom,
  zoomCommandForKey,
} from "../vault/zoom";

const key = (code: string, mods: Partial<Record<string, boolean>> = {}) => ({
  code,
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  ...mods,
});

describe("clampZoom / stepZoom", () => {
  it("clamps and rounds", () => {
    expect(clampZoom(10)).toBe(50);
    expect(clampZoom(999)).toBe(200);
    expect(clampZoom(104.6)).toBe(105);
    expect(clampZoom(NaN)).toBe(100);
  });
  it("steps within bounds", () => {
    expect(stepZoom(100, 1)).toBe(110);
    expect(stepZoom(100, -1)).toBe(90);
    expect(stepZoom(200, 1)).toBe(200);
    expect(stepZoom(50, -1)).toBe(50);
  });
});

describe("zoomCommandForKey", () => {
  const cases: [string, "in" | "out" | "reset"][] = [
    ["Equal", "in"],
    ["NumpadAdd", "in"],
    ["Minus", "out"],
    ["NumpadSubtract", "out"],
    ["Digit0", "reset"],
    ["Numpad0", "reset"],
  ];
  it.each(cases)("mac Cmd+Shift %s", (code, cmd) => {
    expect(
      zoomCommandForKey(key(code, { metaKey: true, shiftKey: true }), true),
    ).toBe(cmd);
    expect(
      zoomCommandForKey(key(code, { ctrlKey: true, shiftKey: true }), true),
    ).toBeNull();
  });
  it.each(cases)("non-mac Ctrl+Shift %s", (code, cmd) => {
    expect(
      zoomCommandForKey(key(code, { ctrlKey: true, shiftKey: true }), false),
    ).toBe(cmd);
    expect(
      zoomCommandForKey(key(code, { metaKey: true, shiftKey: true }), false),
    ).toBeNull();
  });
  it("ignores plain Cmd, Alt and other keys", () => {
    expect(zoomCommandForKey(key("Equal", { metaKey: true }), true)).toBeNull();
    expect(
      zoomCommandForKey(
        key("Equal", { metaKey: true, shiftKey: true, altKey: true }),
        true,
      ),
    ).toBeNull();
    expect(
      zoomCommandForKey(key("KeyA", { metaKey: true, shiftKey: true }), true),
    ).toBeNull();
  });
});

describe("installZoomShortcuts", () => {
  it("claims the event before a bubbling document listener", () => {
    const onCommand = vi.fn();
    const docListener = vi.fn();
    document.addEventListener("keydown", docListener);
    const dispose = installZoomShortcuts(document, { onCommand }, true);
    const ev = new KeyboardEvent("keydown", {
      code: "Equal",
      metaKey: true,
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    document.body.dispatchEvent(ev);
    expect(onCommand).toHaveBeenCalledWith("in");
    expect(ev.defaultPrevented).toBe(true);
    expect(docListener).not.toHaveBeenCalled();

    const plain = new KeyboardEvent("keydown", {
      code: "Equal",
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    document.body.dispatchEvent(plain);
    expect(onCommand).toHaveBeenCalledTimes(1);
    expect(docListener).toHaveBeenCalledTimes(1);

    dispose();
    document.body.dispatchEvent(
      new KeyboardEvent("keydown", {
        code: "Equal",
        metaKey: true,
        shiftKey: true,
        bubbles: true,
      }),
    );
    expect(onCommand).toHaveBeenCalledTimes(1);
    document.removeEventListener("keydown", docListener);
  });
});

describe("applyWebviewZoom", () => {
  beforeEach(() => resetWebviewZoomState());

  it("skips the native call at the default and for repeats", async () => {
    const setZoom = vi.fn().mockResolvedValue(undefined);
    expect(await applyWebviewZoom(100, { setZoom })).toBe(true);
    expect(setZoom).not.toHaveBeenCalled();
    expect(await applyWebviewZoom(120, { setZoom })).toBe(true);
    expect(await applyWebviewZoom(120, { setZoom })).toBe(true);
    expect(setZoom).toHaveBeenCalledTimes(1);
    expect(setZoom).toHaveBeenCalledWith(1.2);
  });
  it("is a no-op outside Tauri", async () => {
    expect(await applyWebviewZoom(150)).toBe(false);
  });
  it("never throws and retries after a failure", async () => {
    const setZoom = vi
      .fn()
      .mockRejectedValueOnce(new Error("x"))
      .mockResolvedValue(undefined);
    expect(await applyWebviewZoom(150, { setZoom })).toBe(false);
    expect(await applyWebviewZoom(150, { setZoom })).toBe(true);
    expect(setZoom).toHaveBeenCalledTimes(2);
  });
  it("serialises calls", async () => {
    const order: string[] = [];
    let release!: () => void;
    const slow = () =>
      new Promise<void>((r) => {
        release = r;
      }).then(() => {
        order.push("a");
      });
    const a = applyWebviewZoom(110, { setZoom: slow });
    const b = applyWebviewZoom(120, {
      setZoom: async () => {
        order.push("b");
      },
    });
    await Promise.resolve();
    release();
    await Promise.all([a, b]);
    expect(order).toEqual(["a", "b"]);
  });
});
