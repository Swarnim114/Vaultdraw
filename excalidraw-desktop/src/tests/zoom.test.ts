// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  applyWebviewZoom,
  clampZoom,
  nextZoom,
  resetWebviewZoomState,
  stepZoom,
} from "../vault/zoom";

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

describe("nextZoom", () => {
  it("steps in and out within bounds", () => {
    expect(nextZoom(100, "in")).toBe(110);
    expect(nextZoom(100, "out")).toBe(90);
    expect(nextZoom(200, "in")).toBe(200);
    expect(nextZoom(50, "out")).toBe(50);
  });
  it("resets to the default", () => {
    expect(nextZoom(170, "reset")).toBe(100);
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
