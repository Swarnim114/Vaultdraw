import { FONT_FAMILY, KEYS } from "@excalidraw/common";

import type { ExcalidrawTextElement } from "@excalidraw/element/types";

import { Excalidraw } from "../index";

import { API } from "./helpers/api";
import { Keyboard, Pointer, UI } from "./helpers/ui";
import { getTextEditor, updateTextEditor } from "./queries/dom";
import { act, render, unmountComponent } from "./test-utils";

import type { NewTextStyle } from "../types";

unmountComponent();

const { h } = window;
const mouse = new Pointer("mouse");

const ORANGE = "#f08c00";
const STYLE: NewTextStyle = {
  strokeColor: ORANGE,
  opacity: 60,
  fontFamily: FONT_FAMILY.Nunito,
  fontSize: 28,
  textAlign: "right",
};

const texts = () =>
  h.elements.filter(
    (el): el is ExcalidrawTextElement => el.type === "text" && !el.isDeleted,
  );

const type = async (text: string) => {
  const editor = await getTextEditor();
  updateTextEditor(editor, text);
  Keyboard.exitTextEditor(editor);
};

describe("newTextStyle prop", () => {
  let style: NewTextStyle | null = null;

  beforeEach(async () => {
    style = null;
    await render(
      <Excalidraw handleKeyboardGlobally newTextStyle={() => style} />,
    );
  });

  afterEach(async () => {
    await act(async () => {});
  });

  it("keeps the current-item state when the host returns null", async () => {
    mouse.doubleClickAt(100, 100);
    await type("plain");
    expect(texts()[0]).toMatchObject({
      strokeColor: h.state.currentItemStrokeColor,
      fontSize: h.state.currentItemFontSize,
      fontFamily: h.state.currentItemFontFamily,
    });
  });

  it("styles text created by double-click on the canvas", async () => {
    style = STYLE;
    mouse.doubleClickAt(100, 100);
    await type("hello");
    expect(texts()[0]).toMatchObject(STYLE);
  });

  it("styles a shape label (Enter on a selected rectangle), centred", async () => {
    style = STYLE;
    const rect = API.createElement({
      type: "rectangle",
      x: 0,
      y: 0,
      width: 200,
      height: 100,
    });
    API.setElements([rect]);
    API.setSelectedElements([rect]);
    Keyboard.keyPress(KEYS.ENTER);
    await type("label");
    const [label] = texts();
    expect(label.containerId).toBe(rect.id);
    expect(label).toMatchObject({
      strokeColor: ORANGE,
      opacity: 60,
      fontFamily: FONT_FAMILY.Nunito,
      fontSize: 28,
      textAlign: "center",
    });
  });

  it("does not restyle an existing text when it is edited", async () => {
    mouse.doubleClickAt(100, 100);
    await type("old");
    style = STYLE;
    const [text] = texts();
    mouse.doubleClickOn(text);
    await type("old, edited");
    expect(texts()).toHaveLength(1);
    expect(texts()[0].strokeColor).not.toBe(ORANGE);
  });

  it("text tool click uses it too (the host decides when to return a style)", async () => {
    style = { strokeColor: ORANGE };
    UI.clickTool("text");
    mouse.clickAt(300, 300);
    await type("tool");
    expect(texts()[0].strokeColor).toBe(ORANGE);
  });
});
