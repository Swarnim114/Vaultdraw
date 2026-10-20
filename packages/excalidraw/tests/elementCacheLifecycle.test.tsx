import React from "react";

import { elementWithCanvasCache } from "@excalidraw/element";

import { Excalidraw } from "../index";

import { render, unmountComponent, waitFor } from "./test-utils";

const seed = () => {
  const key = {} as any;
  elementWithCanvasCache.set(key, {
    canvas: { width: 10, height: 10 } as HTMLCanvasElement,
  } as any);
  return key;
};

describe("element canvas cache and editor lifetime", () => {
  beforeEach(() => unmountComponent());

  it("survives a secondary editor unmounting, cleared by the last one", async () => {
    const Two = ({ second }: { second: boolean }) => (
      <>
        <div style={{ width: 300, height: 300 }}>
          <Excalidraw />
        </div>
        {second && (
          <div style={{ width: 300, height: 300 }}>
            <Excalidraw />
          </div>
        )}
      </>
    );
    const { rerender, unmount } = await render(<Two second />);
    const key = seed();

    rerender(<Two second={false} />);
    await waitFor(() =>
      expect(document.querySelectorAll(".excalidraw").length).toBe(1),
    );
    expect(elementWithCanvasCache.has(key)).toBe(true);

    unmount();
    expect(elementWithCanvasCache.has(key)).toBe(false);
  });
});
