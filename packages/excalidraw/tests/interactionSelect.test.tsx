import React from "react";

import { KEYS } from "@excalidraw/common";

import { Excalidraw } from "../index";

import { API } from "./helpers/api";
import { Keyboard, Pointer } from "./helpers/ui";
import {
  fireEvent,
  GlobalTestState,
  mockBoundingClientRect,
  render,
  restoreOriginalGetBoundingClientRect,
  waitFor,
} from "./test-utils";

import type { ExcalidrawProps } from "../types";

const { h } = window;
const mouse = new Pointer("mouse");

const selectedIds = () =>
  Object.keys(h.state.selectedElementIds).filter(
    (id) => h.state.selectedElementIds[id],
  );

const versions = () => h.elements.map((el) => `${el.id}:${el.version}`);

const dispatchCopy = () => {
  const clipboardData = new DataTransfer();
  document.dispatchEvent(
    Object.assign(new Event("copy", { bubbles: true, cancelable: true }), {
      clipboardData,
    }),
  );
  return clipboardData;
};

const setup = async (interaction?: ExcalidrawProps["interaction"]) => {
  mockBoundingClientRect();
  const a = API.createElement({
    type: "rectangle",
    id: "a",
    x: 10,
    y: 10,
    width: 40,
    height: 40,
    backgroundColor: "#ff0000",
    fillStyle: "solid",
  });
  const b = API.createElement({
    type: "rectangle",
    id: "b",
    x: 100,
    y: 10,
    width: 40,
    height: 40,
    backgroundColor: "#00ff00",
    fillStyle: "solid",
  });
  await render(
    <Excalidraw
      interaction={interaction}
      ui={false}
      autoFocus={true}
      handleKeyboardGlobally={true}
      initialData={{ elements: [a, b] }}
    />,
  );
  await waitFor(() => expect(h.state.width).toBe(200));
  Object.assign(document, { elementFromPoint: () => GlobalTestState.canvas });
  return { a, b };
};

afterEach(() => {
  restoreOriginalGetBoundingClientRect();
});

describe("interaction.enabled.select", () => {
  const config = { enabled: { select: true, navigation: true } };

  beforeEach(async () => {
    await setup(config);
  });

  it("click selects, click on empty space clears", () => {
    mouse.clickAt(30, 30);
    expect(selectedIds()).toEqual(["a"]);
    mouse.clickAt(180, 180);
    expect(selectedIds()).toEqual([]);
  });

  it("shift-click adds and removes", () => {
    mouse.clickAt(30, 30);
    Keyboard.withModifierKeys({ shift: true }, () => mouse.clickAt(120, 30));
    expect(selectedIds().sort()).toEqual(["a", "b"]);
    Keyboard.withModifierKeys({ shift: true }, () => mouse.clickAt(30, 30));
    expect(selectedIds()).toEqual(["b"]);
  });

  it("marquee selects what it contains and leaves no marquee behind", () => {
    mouse.downAt(0, 0);
    mouse.moveTo(80, 70);
    expect(h.state.selectionElement).not.toBe(null);
    mouse.upAt(80, 70);
    expect(selectedIds()).toEqual(["a"]);
    expect(h.state.selectionElement).toBe(null);
  });

  it("Mod+A selects all, Escape clears", () => {
    Keyboard.withModifierKeys({ ctrl: true }, () => Keyboard.keyPress("a"));
    expect(selectedIds().sort()).toEqual(["a", "b"]);
    Keyboard.keyPress(KEYS.ESCAPE);
    expect(selectedIds()).toEqual([]);
  });

  it("copy writes the excalidraw clipboard payload", async () => {
    mouse.clickAt(30, 30);
    const copied = dispatchCopy();
    await waitFor(() => {
      expect(JSON.parse(copied.getData("text/plain")).elements).toEqual([
        expect.objectContaining({ id: "a" }),
      ]);
    });
  });

  it("refuses every mutation", async () => {
    const before = versions();
    mouse.clickAt(30, 30);
    expect(selectedIds()).toEqual(["a"]);

    // drag the selected element
    mouse.downAt(30, 30);
    mouse.moveTo(80, 90);
    mouse.upAt(80, 90);
    expect(h.elements[0].x).toBe(10);
    expect(h.elements[0].y).toBe(10);

    // resize via its bottom-right handle position (the mocked canvas is
    // offset by (20, 10) from the viewport)
    mouse.downAt(70, 60);
    mouse.moveTo(110, 100);
    mouse.upAt(110, 100);
    expect(h.elements[0].width).toBe(40);

    // double click must not open a text editor
    mouse.doubleClickAt(30, 30);
    expect(h.state.editingTextElement).toBe(null);
    expect(document.querySelector(".excalidraw-wysiwyg")).toBe(null);

    mouse.clickAt(30, 30);
    Keyboard.keyPress(KEYS.DELETE);
    Keyboard.keyPress(KEYS.BACKSPACE);
    Keyboard.withModifierKeys({ ctrl: true }, () => {
      Keyboard.keyPress("x");
      Keyboard.keyPress("d");
      Keyboard.keyPress("v");
    });
    const cut = new Event("cut", { bubbles: true, cancelable: true });
    document.dispatchEvent(cut);
    Keyboard.keyPress("r");

    expect(h.state.activeTool.type).toBe("selection");
    expect(h.elements.length).toBe(2);
    expect(h.elements.every((el) => !el.isDeleted)).toBe(true);
    expect(versions()).toEqual(before);
  });

  it("does not drop files", () => {
    const before = versions();
    fireEvent.drop(GlobalTestState.interactiveCanvas, {
      dataTransfer: {
        files: [new File(["x"], "x.png", { type: "image/png" })],
      },
    });
    expect(versions()).toEqual(before);
  });
});

describe("interaction object without select", () => {
  it("clicking does not select", async () => {
    await setup({ enabled: { navigation: true } });
    mouse.clickAt(30, 30);
    expect(selectedIds()).toEqual([]);
    Keyboard.withModifierKeys({ ctrl: true }, () => Keyboard.keyPress("a"));
    expect(selectedIds()).toEqual([]);
  });
});

describe("default interaction", () => {
  it("click selects and drag moves as before", async () => {
    await setup(undefined);
    mouse.clickAt(30, 30);
    expect(selectedIds()).toEqual(["a"]);
    mouse.downAt(30, 30);
    mouse.moveTo(60, 60);
    mouse.upAt(60, 60);
    expect(h.elements[0].x).toBe(40);
  });
});
