import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { purgeAll } from "./purgeRegistry";
import {
  HIDDEN_PURGE_DELAY_MS,
  IDLE_PURGE_DELAY_MS,
  installPurgeTriggers,
} from "./triggers";

vi.mock("./purgeRegistry", () => ({ purgeAll: vi.fn(async () => []) }));

const setVisibility = (state: "hidden" | "visible") => {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: state,
  });
  document.dispatchEvent(new Event("visibilitychange"));
};

describe("purge triggers", () => {
  let releaseNative: ReturnType<typeof vi.fn>;
  let pressure: () => void;
  let dispose: () => void;
  const spy = vi.mocked(purgeAll);

  beforeEach(() => {
    vi.useFakeTimers();
    setVisibility("visible");
    releaseNative = vi.fn();
    spy.mockClear();
    dispose = installPurgeTriggers({
      win: window,
      releaseNative,
      onPressure: (h) => {
        pressure = h;
        return () => {};
      },
    });
  });
  afterEach(() => {
    dispose();
    vi.useRealTimers();
  });

  it("purges after the window stays hidden", async () => {
    setVisibility("hidden");
    await vi.advanceTimersByTimeAsync(HIDDEN_PURGE_DELAY_MS - 1);
    expect(releaseNative).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(releaseNative).toHaveBeenCalledTimes(1);
  });

  it("does not purge when shown again before the delay", async () => {
    setVisibility("hidden");
    await vi.advanceTimersByTimeAsync(HIDDEN_PURGE_DELAY_MS / 2);
    setVisibility("visible");
    await vi.advanceTimersByTimeAsync(HIDDEN_PURGE_DELAY_MS);
    expect(releaseNative).not.toHaveBeenCalled();
  });

  it("purges on idle, and input postpones it", async () => {
    await vi.advanceTimersByTimeAsync(IDLE_PURGE_DELAY_MS - 1000);
    window.dispatchEvent(new Event("keydown"));
    await vi.advanceTimersByTimeAsync(IDLE_PURGE_DELAY_MS - 1);
    expect(releaseNative).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(releaseNative).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenLastCalledWith("idle");
    // Idle fires once until the next input.
    await vi.advanceTimersByTimeAsync(IDLE_PURGE_DELAY_MS * 2);
    expect(releaseNative).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new Event("pointerdown"));
    await vi.advanceTimersByTimeAsync(IDLE_PURGE_DELAY_MS);
    expect(releaseNative).toHaveBeenCalledTimes(2);
  });

  it("purges on a native pressure event", async () => {
    pressure();
    await vi.advanceTimersByTimeAsync(0);
    expect(spy).toHaveBeenLastCalledWith("pressure");
    expect(releaseNative).toHaveBeenCalledTimes(1);
  });
});
