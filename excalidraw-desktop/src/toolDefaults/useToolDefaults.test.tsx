import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getCommand } from "../commands/commands";
import { getRegisteredHandler } from "../commands/handlerRegistry";

import { TOOL_DEFAULT_TOOLS } from "./toolStyles";
import { useToolDefaults } from "./useToolDefaults";

const store = vi.hoisted(() => ({
  defaults: {} as Record<string, Record<string, unknown>>,
  listeners: new Set<() => void>(),
  saved: [] as unknown[],
  reset: [] as unknown[],
}));

vi.mock("../vault/toolDefaultsStore", () => ({
  getEffectiveToolDefaults: () => store.defaults,
  subscribeToolDefaults: (cb: () => void) => {
    store.listeners.add(cb);
    return () => store.listeners.delete(cb);
  },
  saveToolDefault: async (tool: string, style: unknown) => {
    store.saved.push([tool, style]);
    return "global";
  },
  resetToolDefault: async (tool: string) => {
    store.reset.push(tool);
    return "vault";
  },
  toolDefaultLayer: () => "global",
}));

const BASE = {
  currentItemStrokeColor: "#1e1e1e",
  currentItemStrokeWidthKey: "medium",
  currentItemStrokeStyle: "solid",
  selectedElementIds: {} as Record<string, boolean>,
};

function setup() {
  let state: Record<string, unknown> = {
    ...BASE,
    activeTool: { type: "selection" },
  };
  let elements: unknown[] = [];
  const updateScene = vi.fn(({ appState }: { appState: object }) => {
    state = { ...state, ...appState };
  });
  const setToast = vi.fn();
  const api = {
    updateScene,
    setToast,
    getAppState: () => state,
    getSceneElements: () => elements,
  };
  const apiRef = { current: api as never };
  const hook = renderHook(() => useToolDefaults(apiRef, true));
  const emit = () => hook.result.current.onAppState(state as never);
  return {
    hook,
    updateScene,
    setToast,
    emit,
    setElements: (e: unknown[]) => (elements = e),
    get state() {
      return state;
    },
    switchTo(type: string, extra: object = {}) {
      state = { ...state, ...extra, activeTool: { type } };
      emit();
    },
    set(extra: object) {
      state = { ...state, ...extra };
      emit();
    },
  };
}

beforeEach(() => {
  store.defaults = {
    arrow: {
      stroke_color: "#f08c00",
      stroke_width: 3,
      stroke_style: "dotted",
    },
  };
  store.listeners.clear();
  store.saved = [];
  store.reset = [];
});

describe("useToolDefaults", () => {
  it("applies on entry without an undo entry and restores on leave", () => {
    const t = setup();
    t.emit();
    expect(t.updateScene).not.toHaveBeenCalled();
    t.switchTo("arrow");
    expect(t.updateScene).toHaveBeenCalledTimes(1);
    expect(t.updateScene.mock.calls[0][0]).toMatchObject({
      appState: {
        currentItemStrokeColor: "#f08c00",
        currentItemStrokeStyle: "dotted",
      },
      captureUpdate: "NEVER",
    });
    t.emit(); // the change caused by our patch: same tool, no work
    expect(t.updateScene).toHaveBeenCalledTimes(1);
    t.switchTo("selection");
    expect(t.state).toMatchObject(BASE);
    expect(t.updateScene).toHaveBeenCalledTimes(2);
  });

  it("does no work for unconfigured tools or while the tool stays", () => {
    const t = setup();
    t.switchTo("rectangle");
    t.switchTo("freedraw");
    t.set({ currentItemStrokeColor: "#ff0000" });
    t.set({ currentItemOpacity: 50 });
    expect(t.updateScene).not.toHaveBeenCalled();
  });

  it("keeps a pen colour set in the same transition", () => {
    const t = setup();
    t.switchTo("arrow");
    t.switchTo("freedraw", { currentItemStrokeColor: "#ff0000" });
    expect(t.state.currentItemStrokeColor).toBe("#ff0000");
    expect(t.state.currentItemStrokeStyle).toBe("solid");
  });

  it("returns the style's px only for the active tool while its width key stands", () => {
    const t = setup();
    const width = () => t.hook.result.current.currentItemStrokeWidth;
    expect(width()("arrow")).toBeNull();
    t.switchTo("arrow");
    expect(width()("arrow")).toBe(3);
    expect(width()("line")).toBeNull();
    expect(width()("freedraw")).toBeNull();
    t.set({ currentItemStrokeWidthKey: "bold" }); // manual change in the panel
    expect(width()("arrow")).toBeNull();
    t.switchTo("selection");
    expect(width()("arrow")).toBeNull();
  });

  it("keeps one callback identity", () => {
    const t = setup();
    const first = t.hook.result.current;
    t.switchTo("arrow");
    t.hook.rerender();
    expect(t.hook.result.current.currentItemStrokeWidth).toBe(
      first.currentItemStrokeWidth,
    );
    expect(t.hook.result.current.onAppState).toBe(first.onAppState);
  });

  it("re-applies when the active tool's defaults change", () => {
    const t = setup();
    t.switchTo("arrow");
    store.defaults = { arrow: { stroke_color: "#1971c2" } };
    act(() => store.listeners.forEach((cb) => cb()));
    expect(t.state).toMatchObject({
      currentItemStrokeColor: "#1971c2",
      currentItemStrokeStyle: "solid",
    });
    expect(t.hook.result.current.currentItemStrokeWidth("arrow")).toBeNull();
    // a change for another tool does nothing
    const calls = t.updateScene.mock.calls.length;
    store.defaults = { ...store.defaults, line: { stroke_color: "#000000" } };
    act(() => store.listeners.forEach((cb) => cb()));
    expect(t.updateScene.mock.calls.length).toBe(calls);
  });

  it("applies defaults configured while an unconfigured tool is active", () => {
    const t = setup();
    t.switchTo("line");
    store.defaults = { line: { stroke_color: "#2f9e44" } };
    act(() => store.listeners.forEach((cb) => cb()));
    expect(t.state.currentItemStrokeColor).toBe("#2f9e44");
  });
});

describe("tool default commands", () => {
  const run = async (id: string) => {
    await act(async () => {
      await getRegisteredHandler(id)?.();
    });
  };

  it("registers a save and a reset command per tool, plus saveActive", () => {
    for (const tool of TOOL_DEFAULT_TOOLS) {
      expect(getCommand(`toolDefaults.save.${tool}`)?.title).toMatch(
        /^Tool defaults: Save current style for /,
      );
      expect(getCommand(`toolDefaults.reset.${tool}`)?.title).toMatch(
        /^Tool defaults: Reset /,
      );
    }
    expect(getCommand("toolDefaults.saveActive")?.keys.default).toEqual([]);
    expect(getCommand("toolDefaults.save.arrow")?.title).toBe(
      "Tool defaults: Save current style for Arrow",
    );
  });

  it("saves the first selected element of the tool's type", async () => {
    const t = setup();
    t.setElements([
      { id: "r", type: "rectangle", strokeColor: "#000000" },
      {
        id: "a",
        type: "arrow",
        strokeColor: "#e03131",
        strokeWidth: 5,
        strokeStyle: "dashed",
        roughness: 0,
        opacity: 80,
        roundness: null,
        elbowed: false,
        startArrowhead: null,
        endArrowhead: "bar",
      },
    ]);
    t.set({ selectedElementIds: { r: true, a: true } });
    await run("toolDefaults.save.arrow");
    expect(store.saved).toEqual([
      [
        "arrow",
        {
          stroke_color: "#e03131",
          stroke_width: 5,
          stroke_style: "dashed",
          roughness: 0,
          opacity: 80,
          arrow_type: "sharp",
          start_arrowhead: "none",
          end_arrowhead: "bar",
        },
      ],
    ]);
    expect(t.setToast.mock.calls[0][0].message).toBe(
      "Saved Arrow style as the default (global)",
    );
  });

  it("saves the editor's style, with the active px override, when nothing is selected", async () => {
    const t = setup();
    t.switchTo("arrow");
    await run("toolDefaults.save.arrow");
    expect(store.saved[0]).toMatchObject([
      "arrow",
      { stroke_color: "#f08c00", stroke_width: 3, stroke_style: "dotted" },
    ]);
  });

  it("saveActive uses the active tool, else the selection, else asks", async () => {
    const t = setup();
    await run("toolDefaults.saveActive");
    expect(store.saved).toHaveLength(0);
    expect(t.setToast.mock.calls[0][0].message).toBe(
      "Pick a tool or select a shape first",
    );
    t.setElements([
      { id: "r", type: "rectangle", strokeColor: "#000000", roundness: null },
    ]);
    t.set({ selectedElementIds: { r: true } });
    await run("toolDefaults.saveActive");
    expect((store.saved[0] as unknown[])[0]).toBe("rectangle");
    t.switchTo("arrow");
    await run("toolDefaults.saveActive");
    expect((store.saved[1] as unknown[])[0]).toBe("arrow");
  });

  it("reset clears the layer in effect and toasts", async () => {
    const t = setup();
    await run("toolDefaults.reset.line");
    expect(store.reset).toEqual(["line"]);
    expect(t.setToast.mock.calls[0][0].message).toBe(
      "Reset Line default (this vault)",
    );
  });
});
