import { afterEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_PAGE_SETUP } from "@excalidraw/excalidraw/data/pageSetup";

import type { PageSetup } from "@excalidraw/excalidraw/data/pageSetup";

import type { ExcalidrawElement } from "@excalidraw/element/types";

import { resetCanvasSync } from "../editor/canvasSync";

import { PageRuntime } from "./pageRuntime";
import { isPageCommandChecked } from "./pageStatus";
import { rect, touch } from "./testElements";

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const setup: PageSetup = { ...DEFAULT_PAGE_SETUP, pageCount: 1 };

/** A scripted editor: holds state + elements, applies updateScene like the editor does. */
const makeEditor = (
  initial: ExcalidrawElement[],
  pageSetup: PageSetup | null,
) => {
  const editor = {
    elements: initial as readonly ExcalidrawElement[],
    state: {
      pageSetup,
      width: 1000,
      height: 800,
      zoom: { value: 1 },
      scrollX: 0,
      scrollY: 0,
      scrollConstraints: null as any,
      viewModeEnabled: false,
      newElement: null,
      resizingElement: null,
      selectedElementsAreBeingDragged: false,
      editingTextElement: null,
      multiElement: null,
      isResizing: false,
      isRotating: false,
      selectedLinearElement: null,
      selectedElementIds: {} as Record<string, true>,
    } as any,
    updates: [] as any[],
    runtime: null as unknown as PageRuntime,
  };
  const api = {
    getAppState: () => editor.state,
    getSceneElementsIncludingDeleted: () => editor.elements,
    getSceneElementsMapIncludingDeleted: () =>
      new Map(editor.elements.map((e) => [e.id, e])) as any,
    updateScene: (data: any) => {
      editor.updates.push(data);
      if (data.appState) {
        editor.state = { ...editor.state, ...data.appState };
      }
      if (data.elements) {
        editor.elements = [...data.elements];
      }
      // the editor reports every commit
      editor.runtime.onChange(editor.elements, editor.state);
    },
  };
  editor.runtime = new PageRuntime({ getApi: () => api as any });
  return editor;
};

afterEach(() => resetCanvasSync());

describe("PageRuntime", () => {
  it("does nothing with page mode off", async () => {
    const a = rect(-900, -900);
    const e = makeEditor([a], null);
    e.runtime.onChange(e.elements, e.state);
    await flush();
    expect(e.updates).toHaveLength(0);
  });

  it("opening a drawing in page mode installs the lock and leaves old content alone", async () => {
    const old = rect(10, 5000);
    const e = makeEditor([old], setup);
    e.runtime.onChange(e.elements, e.state);
    await flush();
    expect(e.state.scrollConstraints).not.toBeNull();
    expect(e.elements[0]).toBe(old);
    // it only extends the page count to reach the old content (below the pages)
    expect(e.state.pageSetup.pageCount).toBeGreaterThan(1);
  });

  it("clamps an element added later, without recording history", async () => {
    const e = makeEditor([rect(10, 10)], setup);
    e.runtime.onChange(e.elements, e.state);
    await flush();
    e.updates.length = 0;
    const pasted = rect(setup.width + 40, 30);
    e.elements = [...e.elements, pasted];
    e.runtime.onChange(e.elements, e.state);
    await flush();
    const write = e.updates.find((u) => u.elements);
    expect(write.captureUpdate).toBeDefined();
    expect(String(write.captureUpdate)).toBe("NEVER");
    expect(e.elements[1].x).toBe(setup.width - 100);
    // settled: no further writes
    e.updates.length = 0;
    await flush();
    expect(e.updates).toHaveLength(0);
  });

  it("waits for the gesture to end", async () => {
    const e = makeEditor([], setup);
    e.runtime.onChange(e.elements, e.state);
    await flush();
    e.updates.length = 0;
    e.state = { ...e.state, selectedElementsAreBeingDragged: true };
    e.elements = [rect(setup.width + 200, 10)];
    e.runtime.onChange(e.elements, e.state);
    await flush();
    expect(e.updates).toHaveLength(0);
    e.state = { ...e.state, selectedElementsAreBeingDragged: false };
    e.runtime.onChange(e.elements, e.state);
    await flush();
    expect(e.elements[0].x).toBeLessThan(setup.width);
  });

  it("never edits a read-only drawing", async () => {
    const e = makeEditor([], setup);
    e.runtime.onChange(e.elements, e.state);
    await flush();
    e.updates.length = 0;
    e.state = { ...e.state, viewModeEnabled: true };
    e.elements = [rect(setup.width + 200, 10)];
    e.runtime.onChange(e.elements, e.state);
    await flush();
    expect(e.updates).toHaveLength(0);
  });

  it("auto-extends when content reaches the last quarter, never shrinks", async () => {
    const e = makeEditor([], setup);
    e.runtime.onChange(e.elements, e.state);
    await flush();
    e.elements = [rect(10, setup.height * 0.8, 100, 20)];
    e.runtime.onChange(e.elements, e.state);
    await flush();
    expect(e.state.pageSetup.pageCount).toBe(2);
    e.elements = [];
    e.runtime.onChange(e.elements, e.state);
    await flush();
    expect(e.state.pageSetup.pageCount).toBe(2);
  });

  it("re-extends after the page count was lowered (undo of a setup change)", async () => {
    const e = makeEditor([rect(10, setup.height * 1.2, 100, 20)], {
      ...setup,
      pageCount: 3,
    });
    e.runtime.onChange(e.elements, e.state);
    await flush();
    e.state = { ...e.state, pageSetup: { ...e.state.pageSetup, pageCount: 1 } };
    e.runtime.onChange(e.elements, e.state);
    await flush();
    expect(e.state.pageSetup.pageCount).toBeGreaterThanOrEqual(2);
  });

  it("re-installs a cleared lock, and clears it when page mode turns off", async () => {
    const e = makeEditor([], setup);
    e.runtime.onChange(e.elements, e.state);
    await flush();
    e.state = { ...e.state, scrollConstraints: null };
    e.runtime.onChange(e.elements, e.state);
    await flush();
    expect(e.state.scrollConstraints).not.toBeNull();
    e.state = { ...e.state, pageSetup: { ...setup, enabled: false } };
    e.runtime.onChange(e.elements, e.state);
    await flush();
    expect(e.state.scrollConstraints).toBeNull();
  });

  it("re-locks on a window resize", async () => {
    const e = makeEditor([], setup);
    e.runtime.onChange(e.elements, e.state);
    await flush();
    const before = e.state.zoom.value;
    e.state = { ...e.state, width: 1600 };
    e.runtime.onChange(e.elements, e.state);
    await flush();
    expect(e.state.zoom.value).toBeGreaterThan(before);
  });

  it("reports the elements outside the pages", async () => {
    const onOutsideCount = vi.fn();
    const old = rect(-900, 10);
    const e = makeEditor([old, rect(10, 10)], setup);
    e.runtime = new PageRuntime({
      getApi: () => ({
        getAppState: () => e.state,
        getSceneElementsIncludingDeleted: () => e.elements as any,
        getSceneElementsMapIncludingDeleted: () =>
          new Map(e.elements.map((x) => [x.id, x])) as any,
        updateScene: (d: any) => {
          if (d.appState) {
            e.state = { ...e.state, ...d.appState };
          }
        },
      }),
      onOutsideCount,
    });
    e.runtime.onChange(e.elements, e.state);
    await flush();
    expect(onOutsideCount).toHaveBeenLastCalledWith(1);
  });

  it("publishes the setup for the palette's check marks and clears it on dispose", async () => {
    const e = makeEditor([], { ...setup, size: "a5" });
    e.runtime.onChange(e.elements, e.state);
    expect(isPageCommandChecked("page.size.a5")).toBe(true);
    expect(isPageCommandChecked("page.size.a4")).toBe(false);
    expect(isPageCommandChecked("page.on")).toBe(true);
    e.runtime.dispose();
    expect(isPageCommandChecked("page.on")).toBe(false);
  });
});

describe("PageRuntime cost", () => {
  it("idle onChange and one-element change on a 2000 element drawing", async () => {
    const elements: ExcalidrawElement[] = [];
    for (let i = 0; i < 2000; i++) {
      elements.push(
        rect(10 + (i % 6) * 100, 10 + Math.floor(i / 6) * 3, 80, 2),
      );
    }
    const big: PageSetup = { ...setup, pageCount: 200 };
    const e = makeEditor(elements, big);
    e.runtime.onChange(e.elements, e.state);
    await flush();

    const N = 2000;
    let t0 = performance.now();
    for (let i = 0; i < N; i++) {
      e.runtime.onChange(e.elements, e.state);
    }
    const idle = ((performance.now() - t0) / N) * 1000;

    const changeCost: number[] = [];
    for (let i = 0; i < 100; i++) {
      const next = [...e.elements];
      next[i * 7] = touch(next[i * 7], { x: next[i * 7].x + 1 });
      e.elements = next;
      t0 = performance.now();
      e.runtime.onChange(e.elements, e.state);
      e.runtime.applyContent();
      changeCost.push((performance.now() - t0) * 1000);
    }
    changeCost.sort((a, b) => a - b);
    // eslint-disable-next-line no-console
    console.info(
      `[page perf] idle onChange ${idle.toFixed(
        2,
      )} us; one changed element p50 ${changeCost[50].toFixed(
        0,
      )} us p95 ${changeCost[95].toFixed(0)} us (2000 elements)`,
    );
    expect(idle).toBeLessThan(50);
    expect(changeCost[95]).toBeLessThan(5000);
  });
});
