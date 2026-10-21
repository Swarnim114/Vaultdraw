import { newElement, newTextElement } from "@excalidraw/element";
import { describe, expect, it, vi } from "vitest";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { createResolver } from "../../links/resolve";

import { LinkHints } from "./linkHints";
import { linkOpenTarget, ModifierLinks } from "./modifierLinks";
import {
  createLinkOpener,
  createOnLinkOpen,
  iconLinkTarget,
} from "./onLinkOpen";

const ev = (init: Partial<Record<string, unknown>> = {}) =>
  ({
    button: 0,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    ...init,
  } as never);

describe("linkOpenTarget", () => {
  it("modifier alone opens in the current tab", () => {
    expect(linkOpenTarget(ev({ metaKey: true }), "mod", true)).toBe("current");
    expect(linkOpenTarget(ev({ ctrlKey: true }), "mod", false)).toBe("current");
  });
  it("modifier + Shift opens a new tab", () => {
    expect(
      linkOpenTarget(ev({ metaKey: true, shiftKey: true }), "mod", true),
    ).toBe("new");
    expect(
      linkOpenTarget(ev({ altKey: true, shiftKey: true }), "alt", true),
    ).toBe("new");
  });
  it("Shift without the modifier is not a new-tab gesture", () => {
    expect(linkOpenTarget(ev({ shiftKey: true }), "mod", true)).toBe("current");
  });
  it("middle click opens a new tab", () => {
    expect(linkOpenTarget(ev({ button: 1 }), "mod", true)).toBe("new");
    expect(linkOpenTarget(ev({ button: 1 }), "shift", true)).toBe("new");
  });
  it("Shift as the configured modifier means current; only middle is new", () => {
    expect(linkOpenTarget(ev({ shiftKey: true }), "shift", true)).toBe(
      "current",
    );
  });
});

describe("opener target", () => {
  const setup = () => {
    const cb = { openDrawing: vi.fn(), onUnresolved: vi.fn() };
    const openRaw = createLinkOpener({
      getFromPath: () => "a.excalidraw",
      getResolver: () => createResolver(["Notes.excalidraw"]),
      getCallbacks: () => cb,
    });
    return { cb, openRaw };
  };
  it("passes the target to openDrawing, defaulting to current", () => {
    const { cb, openRaw } = setup();
    openRaw("[[Notes]]");
    openRaw("[[Notes]]", { target: "new" });
    expect(cb.openDrawing.mock.calls).toEqual([
      ["Notes.excalidraw", undefined, "current"],
      ["Notes.excalidraw", undefined, "new"],
    ]);
  });
  it("shape link icon: Cmd/Ctrl+Shift or middle -> new, else current", () => {
    expect(iconLinkTarget(undefined)).toBe("current");
    expect(iconLinkTarget(ev({ metaKey: true, shiftKey: true }))).toBe("new");
    expect(iconLinkTarget(ev({ ctrlKey: true, shiftKey: true }))).toBe("new");
    expect(iconLinkTarget(ev({ button: 1 }))).toBe("new");
    expect(iconLinkTarget(ev({ metaKey: true }))).toBe("current");
    expect(iconLinkTarget(ev({ shiftKey: true }))).toBe("current");
    const openRaw = vi.fn(() => true);
    const handler = createOnLinkOpen(openRaw);
    handler(
      { link: "[[Notes]]" },
      {
        preventDefault: vi.fn(),
        detail: { nativeEvent: ev({ metaKey: true, shiftKey: true }) },
      },
    );
    expect(openRaw).toHaveBeenCalledWith("[[Notes]]", { target: "new" });
  });
});

function fakeApi(elements: unknown[]) {
  return {
    getSceneElements: () => elements,
    getAppState: () => ({
      zoom: { value: 1 },
      offsetLeft: 0,
      offsetTop: 0,
      scrollX: 0,
      scrollY: 0,
      width: 1000,
      height: 800,
      selectedElementIds: {},
    }),
  } as unknown as ExcalidrawImperativeAPI;
}

describe("hint mode target", () => {
  const run = (shift: boolean) => {
    const rect = newElement({
      type: "rectangle",
      x: 10,
      y: 10,
      width: 40,
      height: 40,
      link: "[[Notes]]",
    });
    const openRaw = vi.fn(() => true);
    const hints = new LinkHints({
      getApi: () => fakeApi([rect]),
      getHintChars: () => "ab",
      openRaw,
    });
    expect(hints.start()).toBe(true);
    const label = hints.state!.hints[0].label;
    document.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: shift ? label.toUpperCase() : label,
        shiftKey: shift,
        bubbles: true,
        cancelable: true,
      }),
    );
    return openRaw;
  };
  it("plain letters open the current tab", () => {
    expect(run(false)).toHaveBeenCalledWith("[[Notes]]", {
      target: "current",
    });
  });
  it("Shift+letter (upper case) opens a new tab", () => {
    expect(run(true)).toHaveBeenCalledWith("[[Notes]]", { target: "new" });
  });
});

describe("middle click", () => {
  const setup = () => {
    const container = document.createElement("div");
    const openRaw = vi.fn(() => true);
    const text = newTextElement({ text: "go [[Dijkstra]] now", x: 0, y: 0 });
    const ml = new ModifierLinks({
      container,
      getApi: () => fakeApi([text]),
      getModifier: () => "mod",
      openRaw,
    });
    ml.start();
    const w = (text as { width: number }).width;
    const press = (button: number, x: number, init = {}) => {
      const e = new MouseEvent("pointerdown", {
        button,
        clientX: x,
        clientY: 5,
        bubbles: true,
        cancelable: true,
        ...init,
      });
      container.dispatchEvent(e);
      return e;
    };
    return { ml, openRaw, press, w };
  };
  it("opens a new tab only when the pointer is over a link", () => {
    const { ml, openRaw, press, w } = setup();
    const miss = press(1, w + 500);
    expect(miss.defaultPrevented).toBe(false);
    expect(openRaw).not.toHaveBeenCalled();
    const hit = press(1, (w * 8) / 19);
    expect(hit.defaultPrevented).toBe(true);
    expect(openRaw).toHaveBeenCalledWith("[[Dijkstra]]", { target: "new" });
    ml.stop();
  });
  it("ignores plain clicks and right clicks without the modifier", () => {
    const { ml, openRaw, press, w } = setup();
    press(0, (w * 8) / 19);
    press(2, (w * 8) / 19);
    expect(openRaw).not.toHaveBeenCalled();
    ml.stop();
  });
  it("modifier+click is current, modifier+Shift+click is new", () => {
    const { ml, openRaw, press, w } = setup();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Control" }));
    const mac = /Mac|iPhone|iPad/.test(navigator.platform);
    const held = mac ? { metaKey: true } : { ctrlKey: true };
    press(0, (w * 8) / 19, held);
    press(0, (w * 8) / 19, { ...held, shiftKey: true });
    expect(openRaw.mock.calls.map((c) => (c as unknown[])[1])).toEqual([
      { target: "current" },
      { target: "new" },
    ]);
    ml.stop();
  });
});
