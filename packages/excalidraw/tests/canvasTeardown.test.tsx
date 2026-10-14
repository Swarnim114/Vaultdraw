import React from "react";

import { Excalidraw } from "../index";

import { render } from "./test-utils";

const editorCanvases = (container: HTMLElement) =>
  Array.from(container.querySelectorAll<HTMLCanvasElement>("canvas")).filter(
    (c) =>
      c.classList.contains("static") || c.classList.contains("interactive"),
  );

describe("editor canvas teardown", () => {
  // jsdom lays nothing out: give the editor container a size
  beforeEach(() => {
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 400,
      bottom: 300,
      width: 400,
      height: 300,
      toJSON: () => ({}),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("releases the backing stores of the static and interactive canvases", async () => {
    const { container, unmount } = await render(<Excalidraw />);
    const canvases = editorCanvases(container);
    expect(canvases.length).toBe(2);
    canvases.forEach((c) => expect(c.width).toBeGreaterThan(0));

    unmount();
    canvases.forEach((c) => {
      expect(c.width).toBe(0);
      expect(c.height).toBe(0);
    });
  });

  it("keeps full-size canvases after StrictMode's simulated unmount", async () => {
    const { container } = await render(
      <React.StrictMode>
        <Excalidraw />
      </React.StrictMode>,
    );
    const canvases = editorCanvases(container);
    expect(canvases.length).toBe(2);
    canvases.forEach((c) => {
      expect(c.width).toBeGreaterThan(0);
      expect(c.height).toBeGreaterThan(0);
    });
  });
});
