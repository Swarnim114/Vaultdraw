import React from "react";
import { vi } from "vitest";
import { KEYS, reseed } from "@excalidraw/common";
import { CaptureUpdateAction } from "@excalidraw/element";

import "@excalidraw/utils/test-utils";

import { Excalidraw } from "../index";
import { serializeAsJSON } from "../data/json";
import { restoreElements } from "../data/restore";

import { API } from "./helpers/api";
import { Keyboard, Pointer, UI } from "./helpers/ui";
import { render, unmountComponent, act } from "./test-utils";

import type { History } from "../history";
import type { ExcalidrawImperativeAPI } from "../types";

const { h } = window;
const mouse = new Pointer("mouse");

const mount = async (elements?: any[]) => {
  let api!: ExcalidrawImperativeAPI;
  await render(
    <Excalidraw
      handleKeyboardGlobally={true}
      initialData={elements ? { elements } : undefined}
      onExcalidrawAPI={(a) => {
        api = a as ExcalidrawImperativeAPI;
      }}
    />,
  );
  return api;
};

/** id + geometry + color + deleted, ignoring version / nonce / order noise */
const sceneState = () =>
  h.elements.map((e) => [e.id, e.x, e.y, e.backgroundColor, e.isDeleted]);

describe("history export / import across a remount", () => {
  beforeEach(() => {
    unmountComponent();
    reseed(7);
  });

  it("restores undo / redo exactly after remounting the saved scene", async () => {
    const api1 = await mount();

    UI.createElement("rectangle", { x: 0, y: 0, width: 100, height: 100 });
    const rectA = h.elements[0];
    UI.createElement("ellipse", { x: 200, y: 200, width: 100, height: 100 });
    const ellipse = h.elements[1];
    // move A
    mouse.reset();
    mouse.downAt(50, 0);
    mouse.moveTo(80, 40);
    mouse.up();
    // change a property
    API.setSelectedElements([h.elements[0] as any]);
    act(() => {
      api1.updateScene({
        elements: h.elements.map((e) =>
          e.id === rectA.id ? { ...e, backgroundColor: "#ff0000" } : e,
        ) as any,
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      });
    });
    // delete the ellipse
    API.setSelectedElements([h.elements[1] as any]);
    Keyboard.keyPress(KEYS.DELETE);
    expect(h.elements.find((e) => e.id === ellipse.id)!.isDeleted).toBe(true);

    const finalState = sceneState();
    const undoDepth = API.getUndoStack().length;
    expect(undoDepth).toBeGreaterThanOrEqual(4);

    // record the scene after every undo on the original editor
    const expected: ReturnType<typeof sceneState>[] = [finalState];
    for (let i = 0; i < undoDepth; i++) {
      Keyboard.undo();
      expected.push(sceneState());
    }
    for (let i = 0; i < undoDepth; i++) {
      Keyboard.redo();
    }
    expect(sceneState()).toEqual(finalState);

    // "save" and "remount"
    const snapshot = api1.history.export();
    expect(snapshot.undo.length).toBe(undoDepth);
    const json = JSON.parse(serializeAsJSON(h.elements, h.state, {}, "local"));
    unmountComponent();

    const restored = restoreElements(json.elements, null);
    const api2 = await mount(restored);
    expect(sceneState()).toEqual(finalState);
    expect(API.getUndoStack().length).toBe(0);

    const onHistory = vi.fn();
    (h.app as any).history.onHistoryChangedEmitter.on(onHistory);
    act(() => api2.history.import(snapshot));
    expect(onHistory).toHaveBeenCalledTimes(1);
    expect(onHistory.mock.calls[0][0].isUndoStackEmpty).toBe(false);
    expect(API.getUndoStack().length).toBe(undoDepth);

    for (let i = 1; i <= undoDepth; i++) {
      Keyboard.undo();
      expect(sceneState()).toEqual(expected[i]);
    }
    for (let i = undoDepth - 1; i >= 0; i--) {
      Keyboard.redo();
      expect(sceneState()).toEqual(expected[i]);
    }

    // the first new user change after import records normally
    UI.createElement("diamond", { x: 400, y: 0, width: 50, height: 50 });
    expect(API.getUndoStack().length).toBe(undoDepth + 1);
    const visible = () => sceneState().filter((e) => !e[4]);
    Keyboard.undo();
    expect(visible()).toEqual(finalState.filter((e) => !e[4]));
    Keyboard.undo();
    expect(visible()).toEqual(expected[1].filter((e) => !e[4]));
  });

  it("export is a copy: later edits do not change the snapshot", async () => {
    const api = await mount();
    UI.createElement("rectangle", { x: 0, y: 0, width: 50, height: 50 });
    const snap = api.history.export();
    UI.createElement("ellipse", { x: 100, y: 0, width: 50, height: 50 });
    expect(snap.undo.length).toBe(1);
    expect(API.getUndoStack().length).toBe(2);
  });

  it("import into a different scene does not throw", async () => {
    const api1 = await mount();
    UI.createElement("rectangle", { x: 0, y: 0, width: 100, height: 100 });
    UI.createElement("rectangle", { x: 200, y: 0, width: 100, height: 100 });
    const snap = api1.history.export();
    unmountComponent();

    const api2 = await mount([
      API.createElement({ type: "ellipse", id: "other", x: 5, y: 5 }),
    ]);
    act(() => api2.history.import(snap));
    expect(() => {
      Keyboard.undo();
      Keyboard.undo();
      Keyboard.redo();
    }).not.toThrow();
    expect(h.elements.some((e) => e.id === "other")).toBe(true);
  });

  it("import fails safe: a bad snapshot clears history", async () => {
    const api = await mount();
    UI.createElement("rectangle", { x: 0, y: 0, width: 50, height: 50 });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    act(() => api.history.import({ undo: null, redo: [] } as any));
    expect(API.getUndoStack().length).toBe(0);
    expect(API.getRedoStack().length).toBe(0);
    spy.mockRestore();
  });

  it("benchmark: export / import of 1,000 deltas", async () => {
    const api = await mount();
    const h2 = (h.app as any).history as History;
    const rect = API.createElement({ type: "rectangle" });
    API.setElements([rect]);
    const proto = API.getUndoStack();
    UI.createElement("rectangle", { x: 0, y: 0, width: 50, height: 50 });
    const delta = proto[0];
    for (let i = 0; i < 1000; i++) {
      h2.undoStack.push(delta);
    }
    const t0 = performance.now();
    const snap = api.history.export();
    const t1 = performance.now();
    api.history.import(snap);
    const t2 = performance.now();
    // eslint-disable-next-line no-console
    console.log(
      `BENCH export=${(t1 - t0).toFixed(3)}ms import=${(t2 - t1).toFixed(
        3,
      )}ms n=${snap.undo.length}`,
    );
    expect(t1 - t0).toBeLessThan(2);
    expect(t2 - t1).toBeLessThan(2);
  });
});
