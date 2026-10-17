import { act, cleanup, render, renderHook } from "@testing-library/react";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { createResolver } from "../../../links/resolve";

import { cardPosition, modifierLabel } from "./format";
import { linkBoxesOf } from "./linkBoxes";
import { DWELL_MS } from "./LinkPreviewController";
import { useLinkPreview } from "./useLinkPreview";

import type { UseLinkPreviewOptions } from "./useLinkPreview";
import type { VersionedText } from "./linkBoxes";

const measure = (t: string) => t.length * 10;

const el: VersionedText = {
  id: "t",
  type: "text",
  x: 100,
  y: 100,
  width: 160,
  height: 25,
  angle: 0,
  fontSize: 20,
  fontFamily: 1,
  lineHeight: 1.25,
  textAlign: "left",
  text: "go [[Work/Notes]] now",
  version: 1,
};
const missing: VersionedText = {
  ...el,
  id: "m",
  y: 300,
  text: "go [[Nope]] now",
};
// Seed the cache so the controller never needs real text measuring.
linkBoxesOf(el, measure);
linkBoxesOf(missing, measure);

const appState = (extra: object = {}) => ({
  zoom: { value: 1 },
  offsetLeft: 0,
  offsetTop: 0,
  scrollX: 0,
  scrollY: 0,
  ...extra,
});

let state: Record<string, unknown>;
const fakeApi = () =>
  ({
    getSceneElements: () => [el, missing],
    getAppState: () => state,
  } as unknown as ExcalidrawImperativeAPI);

const resolver = createResolver(["Work/Notes.excalidraw"]);

let container: HTMLElement;
let canvas: HTMLCanvasElement;

const move = (x: number, y: number, init: MouseEventInit = {}, t = canvas) =>
  act(() => {
    t.dispatchEvent(
      new MouseEvent("pointermove", {
        bubbles: true,
        clientX: x,
        clientY: y,
        ...init,
      }),
    );
    vi.advanceTimersByTime(20); // rAF
  });
const dwell = () => act(() => vi.advanceTimersByTime(DWELL_MS + 1));

function setup(over: Partial<UseLinkPreviewOptions> = {}) {
  const props = {
    api: fakeApi(),
    containerEl: container,
    mode: "always",
    modifier: "mod",
    resolver,
    currentPath: "a.excalidraw",
    ...over,
  } as UseLinkPreviewOptions;
  const hook = renderHook((p: UseLinkPreviewOptions) => useLinkPreview(p), {
    initialProps: props,
  });
  const ui = render(<div>{hook.result.current}</div>);
  const rerender = (p: Partial<UseLinkPreviewOptions> = {}) => {
    hook.rerender({ ...props, ...p });
    ui.rerender(<div>{hook.result.current}</div>);
  };
  return { hook, ui, props, rerender };
}

beforeAll(async () => {
  await import("./LinkPreviewCard"); // the lazy chunk, loaded once
});

beforeEach(() => {
  vi.useFakeTimers({
    toFake: [
      "setTimeout",
      "clearTimeout",
      "requestAnimationFrame",
      "cancelAnimationFrame",
    ],
  });
  state = appState();
  container = document.createElement("div");
  canvas = document.createElement("canvas");
  container.appendChild(canvas);
  document.body.appendChild(container);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

const card = () => document.querySelector("[data-testid=link-preview]");

/** Hook that re-renders its overlay on every state change. */
function Harness(p: UseLinkPreviewOptions) {
  return <>{useLinkPreview(p)}</>;
}
const mountHarness = (over: Partial<UseLinkPreviewOptions> = {}) =>
  render(
    <Harness
      {...({
        api: fakeApi(),
        containerEl: container,
        mode: "always",
        modifier: "mod",
        resolver,
        currentPath: "a.excalidraw",
        ...over,
      } as UseLinkPreviewOptions)}
    />,
  );

const flush = async () => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
};

describe("useLinkPreview controller", () => {
  it("off mode attaches no listeners", () => {
    const cAdd = vi.spyOn(container, "addEventListener");
    const wAdd = vi.spyOn(window, "addEventListener");
    setup({ mode: "off" });
    expect(cAdd).not.toHaveBeenCalled();
    expect(wAdd).not.toHaveBeenCalled();
  });

  it("removes its listeners and timers on unmount", () => {
    const cRemove = vi.spyOn(container, "removeEventListener");
    const view = mountHarness();
    move(150, 110);
    view.unmount();
    expect(cRemove.mock.calls.map((c) => c[0]).sort()).toEqual([
      "pointerdown",
      "pointerleave",
      "pointermove",
      "wheel",
    ]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("shows after the dwell, restarts on another link, hides on leave", async () => {
    mountHarness();
    move(150, 110);
    act(() => vi.advanceTimersByTime(DWELL_MS - 50));
    expect(card()).toBeNull();
    move(152, 110); // same link: no restart
    act(() => vi.advanceTimersByTime(60));
    await flush();
    expect(card()?.textContent).toContain("Notes");
    move(150, 310); // another link
    expect(card()).toBeNull();
    dwell();
    await flush();
    expect(card()?.textContent).toContain("No drawing named Nope");
    expect(card()?.textContent).toContain("-click to create");
    act(() => {
      container.dispatchEvent(new MouseEvent("pointerleave"));
    });
    expect(card()).toBeNull();
  });

  it("does nothing off a link", () => {
    mountHarness();
    move(10, 10);
    dwell();
    expect(card()).toBeNull();
  });

  it("hides on pointerdown, wheel and keydown; buttons held blocks it", async () => {
    mountHarness();
    const showIt = async () => {
      move(150, 110);
      dwell();
      await flush();
      expect(card()).not.toBeNull();
    };
    await showIt();
    act(() => {
      container.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    });
    expect(card()).toBeNull();
    await showIt();
    act(() => {
      container.dispatchEvent(new Event("wheel", { bubbles: true }));
    });
    expect(card()).toBeNull();
    await showIt();
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));
    });
    expect(card()).toBeNull();
    move(150, 110, { buttons: 1 });
    dwell();
    expect(card()).toBeNull();
  });

  it("is blocked while editing text and when the target is not the canvas", () => {
    mountHarness();
    state = appState({ editingTextElement: { id: "x" } });
    move(150, 110);
    dwell();
    expect(card()).toBeNull();
    state = appState();
    const button = document.createElement("button");
    container.appendChild(button);
    move(150, 110, {}, button as never);
    dwell();
    expect(card()).toBeNull();
  });

  it("hides when the view scrolls", async () => {
    mountHarness();
    move(150, 110);
    dwell();
    await flush();
    expect(card()).not.toBeNull();
    state = appState({ scrollX: 40 });
    move(150, 110); // the link moved away from the pointer
    expect(card()).toBeNull();
  });

  it("modifier mode needs the modifier", async () => {
    const isMac = /Mac/.test(navigator.platform);
    const key = isMac ? "metaKey" : "ctrlKey";
    mountHarness({ mode: "modifier" });
    move(150, 110);
    dwell();
    expect(card()).toBeNull();
    move(150, 110, { [key]: true });
    dwell();
    await flush();
    expect(card()).not.toBeNull();
    // releasing the modifier hides
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keyup", { key: isMac ? "Meta" : "Control" }),
      );
    });
    expect(card()).toBeNull();
  });

  it("requests a thumbnail once and fills it in", async () => {
    let release: (v: { json: string; revision: string }) => void = () => {};
    const readDrawing = vi.fn(
      () =>
        new Promise<{ json: string; revision: string }>((r) => (release = r)),
    );
    const renderSvg = vi.fn(async () => "data:image/svg+xml,x");
    const mod = await import("./previewThumbnails");
    const real = mod.createPreviewThumbnails;
    vi.spyOn(mod, "createPreviewThumbnails").mockImplementation((o) =>
      real({ ...o, renderSvg }),
    );
    mountHarness({ readDrawing });
    move(150, 110);
    dwell();
    await flush();
    expect(card()?.querySelector("img")).toBeNull();
    expect(
      card()?.querySelector("[data-testid=link-preview-placeholder]"),
    ).not.toBeNull();
    release({ json: "{}", revision: "r1" });
    await flush();
    await flush();
    await flush();
    expect(readDrawing).toHaveBeenCalledTimes(1);
    expect(readDrawing).toHaveBeenCalledWith("Work/Notes.excalidraw");
    expect(card()?.querySelector("img")?.getAttribute("src")).toBe(
      "data:image/svg+xml,x",
    );
    expect(renderSvg).toHaveBeenCalledTimes(1);
  });

  it("renders the resolved card with name, folder and modifier hint", async () => {
    mountHarness();
    move(150, 110);
    dwell();
    await flush();
    const text = card()?.textContent ?? "";
    expect(text).toContain("Notes");
    expect(text).toContain("Work");
    expect(text).toContain(`${modifierLabel("mod")}-click to open`);
  });
});

describe("cardPosition", () => {
  const box = { left: 0, top: 0, width: 800, height: 600 };
  const r = (left: number, top: number) => [{ left, top, width: 50, angle: 0 }];
  it("goes below, flips above near the bottom, clamps sideways", () => {
    expect(cardPosition(r(100, 100), 25, box)).toEqual({
      left: 100,
      top: 106,
      above: false,
    });
    const flipped = cardPosition(r(100, 550), 25, box);
    expect(flipped.above).toBe(true);
    expect(flipped.top).toBeLessThan(550);
    expect(cardPosition(r(790, 100), 25, box).left).toBe(800 - 260 - 4);
    expect(cardPosition(r(-50, 100), 25, box).left).toBe(4);
  });
});
