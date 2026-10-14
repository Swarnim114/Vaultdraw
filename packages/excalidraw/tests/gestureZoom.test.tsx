import React from "react";
import { act, waitFor } from "@testing-library/react";

import { Excalidraw } from "../index";

import { GlobalTestState, render } from "./test-utils";

const { h } = window;

/** Safari's trackpad pinch: gesture events on the document carrying a cumulative `scale`. */
const gesture = (type: string, scale: number) => {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "scale", { value: scale });
  act(() => {
    GlobalTestState.interactiveCanvas.dispatchEvent(event);
  });
};

describe("trackpad pinch (Safari gesture events)", () => {
  beforeEach(async () => {
    await render(<Excalidraw />);
  });

  it("zooms from the cached element bitmaps while pinching, crisp again after", async () => {
    const start = h.state.zoom.value;
    gesture("gesturestart", 1);
    gesture("gesturechange", 1.5);

    expect(h.state.zoom.value).toBeCloseTo(start * 1.5);
    // no re-rasterizing of every element at every pinch step
    expect(h.state.shouldCacheIgnoreZoom).toBe(true);

    gesture("gesturechange", 1.25);
    expect(h.state.zoom.value).toBeCloseTo(start * 1.25);
    expect(h.state.shouldCacheIgnoreZoom).toBe(true);
    gesture("gestureend", 1.25);

    await waitFor(() => expect(h.state.shouldCacheIgnoreZoom).toBe(false), {
      timeout: 2000,
    });
    expect(h.state.zoom.value).toBeCloseTo(start * 1.25);
  });
});
