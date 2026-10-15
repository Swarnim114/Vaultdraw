import { newElement, newTextElement } from "@excalidraw/element";
import { act, cleanup, render, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { DEFAULT_LINKS_SETTINGS } from "../../links/types";

import { useEditorLinks } from "./useEditorLinks";

import type { LinksSettings } from "../../links/types";

const NAMES = ["Graphs/Dijkstra.excalidraw", "Notes.excalidraw"];

afterEach(() => {
  vi.restoreAllMocks();
  cleanup();
  document.body.innerHTML = "";
});

function fakeApi(elements: unknown[], selected: Record<string, boolean> = {}) {
  const updateScene = vi.fn();
  const api = {
    getSceneElements: () => elements,
    getSceneElementsIncludingDeleted: () => elements,
    getAppState: () => ({
      zoom: { value: 1 },
      offsetLeft: 0,
      offsetTop: 0,
      scrollX: 0,
      scrollY: 0,
      width: 1000,
      height: 800,
      selectedElementIds: selected,
    }),
    updateScene,
  } as unknown as ExcalidrawImperativeAPI;
  return { api, updateScene };
}

function mount(
  api: ExcalidrawImperativeAPI | null,
  settings: Partial<LinksSettings> = {},
) {
  const containerEl = document.createElement("div");
  document.body.appendChild(containerEl);
  const callbacks = {
    openDrawing: vi.fn(),
    onUnresolved: vi.fn(),
    onCreate: vi.fn(),
  };
  const hook = renderHook(() =>
    useEditorLinks({
      api,
      containerEl,
      settings: { ...DEFAULT_LINKS_SETTINGS, ...settings },
      names: NAMES,
      currentPath: "Work/a.excalidraw",
      callbacks,
    }),
  );
  return { hook, callbacks, containerEl };
}

describe("useEditorLinks", () => {
  it("costs only the idle listeners until a link is used", () => {
    const observe = vi.spyOn(MutationObserver.prototype, "observe");
    const docAdd = vi.spyOn(document, "addEventListener");
    const { hook, containerEl } = mount(fakeApi([]).api);
    expect(observe).toHaveBeenCalledTimes(1);
    expect(observe.mock.calls[0][1]).toEqual({
      childList: true,
      subtree: true,
    });
    // (React itself adds its own `selectionchange` listener on first mount.)
    const ours = docAdd.mock.calls
      .map((c) => c[0])
      .filter((n) => n !== "selectionchange");
    expect(ours.sort()).toEqual(["keydown", "keyup"]);
    const containerAdd = vi.spyOn(containerEl, "addEventListener");
    expect(containerAdd).not.toHaveBeenCalled();
    hook.unmount();
    observe.mockRestore();
    docAdd.mockRestore();
  });

  it("attaches no observer when autocomplete is off", () => {
    const observe = vi.spyOn(MutationObserver.prototype, "observe");
    mount(fakeApi([]).api, { autocomplete: false });
    expect(observe).not.toHaveBeenCalled();
    observe.mockRestore();
  });

  it("provides onLinkOpen that opens, creates and blocks navigation", async () => {
    const { hook, callbacks } = mount(fakeApi([]).api);
    const ev = { preventDefault: vi.fn() };
    const { onLinkOpen } = hook.result.current;
    onLinkOpen({ link: "[[Dijkstra]]" } as never, ev as never);
    expect(callbacks.openDrawing).toHaveBeenCalledWith(
      "Graphs/Dijkstra.excalidraw",
    );
    onLinkOpen({ link: "[[Ghost]]" } as never, ev as never);
    await vi.waitFor(() =>
      expect(callbacks.onUnresolved).toHaveBeenCalledWith("Ghost"),
    );
    onLinkOpen({ link: "/x" } as never, ev as never);
    expect(ev.preventDefault).toHaveBeenCalledTimes(3);
  });

  it("opens the link under the selection (shape link, then text link)", () => {
    const rect = newElement({
      type: "rectangle",
      x: 0,
      y: 0,
      link: "[[Notes]]",
    });
    const text = newTextElement({ text: "see [[Dijkstra]]", x: 0, y: 100 });
    const { hook, callbacks } = mount(
      fakeApi([rect, text], { [rect.id]: true }).api,
    );
    expect(hook.result.current.openLinkUnderSelection()).toBe(true);
    expect(callbacks.openDrawing).toHaveBeenLastCalledWith("Notes.excalidraw");
    const t = mount(fakeApi([rect, text], { [text.id]: true }).api);
    expect(t.hook.result.current.openLinkUnderSelection()).toBe(true);
    expect(t.callbacks.openDrawing).toHaveBeenCalledWith(
      "Graphs/Dijkstra.excalidraw",
    );
    const none = mount(fakeApi([rect, text], {}).api);
    expect(none.hook.result.current.openLinkUnderSelection()).toBe(false);
  });

  it("links the selection in the configured shape format, undoably", () => {
    const rect = newElement({ type: "rectangle", x: 0, y: 0 });
    const a = fakeApi([rect], { [rect.id]: true });
    const wiki = mount(a.api);
    expect(
      wiki.hook.result.current.linkSelectionTo("Graphs/Dijkstra.excalidraw"),
    ).toBe(1);
    expect(a.updateScene.mock.calls[0][0].elements[0].link).toBe(
      "[[Dijkstra]]",
    );
    expect(a.updateScene.mock.calls[0][0].captureUpdate).toBe("IMMEDIATELY");
    const b = fakeApi([rect], { [rect.id]: true });
    const url = mount(b.api, { shapeLinkFormat: "vaultdraw-url" });
    url.hook.result.current.linkSelectionTo("Graphs/Dijkstra.excalidraw");
    expect(b.updateScene.mock.calls[0][0].elements[0].link).toBe(
      "vaultdraw://open?file=Dijkstra",
    );
  });

  it("starts hint mode and renders its overlay; nothing without an api", () => {
    const rect = newElement({
      type: "rectangle",
      x: 10,
      y: 10,
      width: 40,
      height: 40,
      link: "[[Notes]]",
    });
    const { hook } = mount(fakeApi([rect]).api);
    const view = render(<>{hook.result.current.overlays}</>);
    expect(view.container.querySelector(".vault-link-hint")).toBeNull();
    let started = false;
    act(() => {
      started = hook.result.current.startLinkHints();
    });
    expect(started).toBe(true);
    view.rerender(<>{hook.result.current.overlays}</>);
    expect(view.container.querySelector(".vault-link-hint")?.textContent).toBe(
      "a",
    );
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(view.container.querySelector(".vault-link-hint")).toBeNull();
    const none = mount(null);
    expect(none.hook.result.current.startLinkHints()).toBe(false);
    expect(
      none.hook.result.current.applyEdits([
        { elementId: "x", field: "link", value: "" },
      ]),
    ).toBe(0);
  });
});
