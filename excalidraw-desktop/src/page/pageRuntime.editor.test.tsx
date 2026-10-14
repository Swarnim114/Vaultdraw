// Runs the page runtime against the real editor: commit-time clamps must be
// invisible to undo/redo (captureUpdate NEVER) and stay sane across them.
import { act, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { CaptureUpdateAction, Excalidraw } from "@excalidraw/excalidraw";
import { DEFAULT_PAGE_SETUP } from "@excalidraw/excalidraw/data/pageSetup";
import { Keyboard } from "@excalidraw/excalidraw/tests/helpers/ui";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { resetCanvasSync } from "../editor/canvasSync";

import { PageRuntime } from "./pageRuntime";
import { rect } from "./testElements";

const setup = { ...DEFAULT_PAGE_SETUP, pageCount: 2 };
const W = setup.width;

afterEach(() => resetCanvasSync());

const mount = async () => {
  let api!: ExcalidrawImperativeAPI;
  let runtime!: PageRuntime;
  render(
    <div style={{ width: 1000, height: 800 }}>
      <Excalidraw
        handleKeyboardGlobally
        initialData={{ appState: { pageSetup: setup } as any, elements: [] }}
        onInitialize={(a) => {
          api = a;
          runtime = new PageRuntime({ getApi: () => api });
        }}
        onChange={(elements, state) => runtime?.onChange(elements, state)}
      />
    </div>,
  );
  await waitFor(() => expect(api).toBeTruthy());
  return { api: () => api };
};

const flush = () => act(() => new Promise<void>((r) => setTimeout(r, 20)));
const live = (api: ExcalidrawImperativeAPI) =>
  api.getSceneElements().filter((e) => !e.isDeleted);

describe("page enforcement in the real editor", () => {
  it("clamps a pasted element, and undo / redo stay sane", async () => {
    const { api } = await mount();
    await flush();
    const pasted = rect(W + 80, 40, 100, 60);

    act(() => {
      api().updateScene({
        elements: [pasted] as any,
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      });
    });
    await flush();
    expect(live(api())).toHaveLength(1);
    expect(live(api())[0].x).toBe(W - 100);

    // undo removes the paste (the clamp left no history entry of its own)
    act(() => Keyboard.undo());
    await flush();
    expect(live(api())).toHaveLength(0);

    // redo brings it back and the runtime pulls it inside again
    act(() => Keyboard.redo());
    await flush();
    expect(live(api())).toHaveLength(1);
    expect(live(api())[0].x).toBe(W - 100);

    // one more round trip: no drift, no duplicates
    act(() => Keyboard.undo());
    await flush();
    act(() => Keyboard.redo());
    await flush();
    expect(live(api())).toHaveLength(1);
    expect(live(api())[0].x).toBe(W - 100);
  });

  it("a nudge that pushes an element out is blocked; undo/redo never leave it outside", async () => {
    const { api } = await mount();
    await flush();
    const el = rect(W - 100, 40, 100, 60);
    act(() => {
      api().updateScene({
        elements: [el] as any,
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      });
    });
    await flush();
    const inside = live(api())[0];

    act(() => {
      api().updateScene({
        elements: [
          { ...inside, x: inside.x + 30, version: inside.version + 1 },
        ] as any,
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      });
    });
    await flush();
    expect(live(api())[0].x).toBe(W - 100);

    // The blocked nudge is a net no-op, which the editor's history skips:
    // undo goes on to the previous entry (the creation). Nothing breaks.
    act(() => Keyboard.undo());
    await flush();
    expect(live(api()).every((e) => e.x + e.width <= W)).toBe(true);
    act(() => Keyboard.redo());
    await flush();
    act(() => Keyboard.redo());
    await flush();
    const after = live(api());
    expect(after).toHaveLength(1);
    expect(after[0].x + after[0].width).toBeLessThanOrEqual(W);
  });
});
