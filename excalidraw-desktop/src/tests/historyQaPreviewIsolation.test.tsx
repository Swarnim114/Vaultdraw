import { act, fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import VersionPreview from "../history/preview/VersionPreview";

import type { LoadedVersion } from "../history/preview/versionCache";

const rect = (id: string, x: number) =>
  ({
    id,
    type: "rectangle",
    x,
    y: 0,
    width: 40,
    height: 40,
    version: 1,
    versionNonce: x + 1,
    index: `a${x / 100}`,
    isDeleted: false,
  } as any);

const version: LoadedVersion = {
  id: "v1",
  fileRevision: "r",
  elements: [rect("one", 0), rect("two", 100)],
  appState: {},
  files: {},
  imagesLoaded: true,
  elementCount: 2,
};

const KEYS: Array<Partial<KeyboardEventInit> & { key: string; code: string }> =
  [
    { key: "Delete", code: "Delete" },
    { key: "Backspace", code: "Backspace" },
    { key: "a", code: "KeyA", ctrlKey: true },
    { key: "a", code: "KeyA", metaKey: true },
    { key: "x", code: "KeyX", ctrlKey: true },
    { key: "d", code: "KeyD", ctrlKey: true },
    { key: "v", code: "KeyV", ctrlKey: true },
    { key: "z", code: "KeyZ", ctrlKey: true },
    { key: "r", code: "KeyR" },
    { key: "t", code: "KeyT" },
    { key: "Enter", code: "Enter" },
    { key: "ArrowRight", code: "ArrowRight" },
  ];

describe("preview isolation (PLAN M5)", () => {
  it("keys never change the previewed scene, and nothing is saved", async () => {
    const onApi = vi.fn();
    const { container } = render(
      <VersionPreview
        version={version}
        initialViewport={null}
        theme="light"
        onApi={onApi}
      />,
    );
    await act(async () => {});
    const api = onApi.mock.calls.find((c) => c[0])![0];
    const before = JSON.stringify(api.getSceneElementsIncludingDeleted());

    const targets = [
      document,
      container.querySelector(".excalidraw-container") ?? container,
      container.querySelector("canvas.interactive") ?? container,
    ];
    for (const target of targets) {
      for (const init of KEYS) {
        await act(async () => {
          fireEvent.keyDown(target, { bubbles: true, ...init });
          fireEvent.keyUp(target, { bubbles: true, ...init });
        });
      }
    }
    expect(JSON.stringify(api.getSceneElementsIncludingDeleted())).toBe(before);
    expect(api.getAppState().activeTool.type).toBe("selection");
    expect(api.getAppState().openDialog).toBeNull();
    // Only selection may change: nothing else of the scene state.
    expect(api.getSceneElements().every((e: any) => !e.isDeleted)).toBe(true);
  });

  it("clear canvas never opens its confirm dialog in the preview", async () => {
    const onApi = vi.fn();
    const { container } = render(
      <VersionPreview
        version={version}
        initialViewport={null}
        theme="light"
        onApi={onApi}
      />,
    );
    await act(async () => {});
    await act(async () => {
      fireEvent.keyDown(document, {
        key: "Delete",
        code: "Delete",
        ctrlKey: true,
        metaKey: true,
        bubbles: true,
      });
    });
    expect(container.querySelector(".Dialog, .Modal")).toBeNull();
    expect(document.querySelector("[role='dialog']")).toBeNull();
  });
});
