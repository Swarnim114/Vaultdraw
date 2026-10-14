import { Excalidraw } from "../index";

import { API } from "./helpers/api";
import { act, render } from "./test-utils";

import type { EditorPaletteCommand } from "../types";

const { h } = window;

const getItems = () => h.app.api.getCommandPaletteItems();
const getItem = (id: string): EditorPaletteCommand => {
  const item = getItems().find((item) => item.id === id);
  if (!item) {
    throw new Error(`missing palette item "${id}"`);
  }
  return item;
};

describe("getCommandPaletteItems (imperative API)", () => {
  beforeEach(async () => {
    await render(<Excalidraw handleKeyboardGlobally={true} />);
  });

  it("returns items with unique ids and the expected built-ins", () => {
    const ids = getItems().map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of [
      "alignLeft",
      "group",
      "bringToFront",
      "flipHorizontal",
      "toggleElementLock",
      "gridMode",
      "zenMode",
      "viewMode",
      "clearCanvas",
      "imageExport",
      "tool.rectangle",
      "canvasBackground",
      "addToLibrary",
    ]) {
      expect(ids).toContain(id);
    }
    expect(getItems().every((item) => item.label.length > 0)).toBe(true);
    expect(getItem("group").shortcut).toBeTruthy();
    expect(getItem("tool.rectangle").shortcut).toBeTruthy();
  });

  it("evaluates availability from the current selection", () => {
    expect(getItem("alignLeft").available).toBe(false);

    const a = API.createElement({ type: "rectangle", x: 0, y: 0 });
    const b = API.createElement({ type: "rectangle", x: 100, y: 100 });
    API.setElements([a, b]);
    API.setSelectedElements([a, b]);

    expect(getItem("alignLeft").available).toBe(true);
  });

  it("performs alignLeft on the selection and keeps it selected", () => {
    const a = API.createElement({ type: "rectangle", x: 0, y: 0 });
    const b = API.createElement({ type: "rectangle", x: 100, y: 100 });
    API.setElements([a, b]);
    API.setSelectedElements([a, b]);

    act(() => getItem("alignLeft").perform());

    const [na, nb] = h.elements;
    expect(na.x).toBe(nb.x);
    expect(h.state.selectedElementIds).toEqual({ [a.id]: true, [b.id]: true });
  });

  it("performs tool.rectangle", () => {
    act(() => getItem("tool.rectangle").perform());
    expect(h.state.activeTool.type).toBe("rectangle");
  });
});
