import type { ExcalidrawFreeDrawElement } from "@excalidraw/element/types";

import { Excalidraw } from "../index";

import { API } from "./helpers/api";
import { UI } from "./helpers/ui";
import { act, render } from "./test-utils";

import type { FreedrawPen, LaserPointerSettings } from "../types";

const { h } = window;

describe("freedrawPen prop", () => {
  let pen: FreedrawPen | null = null;

  beforeEach(async () => {
    pen = null;
    await render(<Excalidraw freedrawPen={() => pen} />);
  });

  afterEach(async () => {
    await act(async () => {});
  });

  it("uses the regular width and streamline without a pen", () => {
    UI.createElement("freedraw", { x: 0, y: 0 });
    const el = h.elements[0] as ExcalidrawFreeDrawElement;
    expect(el.strokeWidth).toBe(1);
    expect(el.strokeOptions.streamline).toBe(0.5);
  });

  it("applies the pen's width and streamline", () => {
    pen = { strokeWidth: 7, streamline: 0.1 };
    UI.createElement("freedraw", { x: 0, y: 0 });
    const el = h.elements[0] as ExcalidrawFreeDrawElement;
    expect(el.strokeWidth).toBe(7);
    expect(el.strokeOptions.streamline).toBe(0.1);
  });

  it("inserts a highlighter stroke behind existing elements", () => {
    API.setElements([
      API.createElement({ type: "rectangle", x: 100, y: 100, id: "rect" }),
    ]);
    pen = { strokeWidth: 10, behind: true };
    UI.createElement("freedraw", { x: 0, y: 0 });
    expect(h.elements.map((e) => e.type)).toEqual(["freedraw", "rectangle"]);
  });

  it("puts a highlighter above a filled shape but below text", () => {
    API.setElements([
      API.createElement({ type: "text", x: 0, y: 0, text: "hi", id: "t" }),
      API.createElement({
        type: "rectangle",
        x: 100,
        y: 100,
        backgroundColor: "#ffc9c9",
        id: "filled",
      }),
      API.createElement({ type: "text", x: 0, y: 50, text: "yo", id: "t2" }),
    ]);
    pen = { strokeWidth: 10, behind: true };
    UI.createElement("freedraw", { x: 0, y: 0 });
    expect(h.elements.map((e) => e.type)).toEqual([
      "text",
      "rectangle",
      "freedraw",
      "text",
    ]);
  });

  it("keeps a regular stroke on top", () => {
    API.setElements([
      API.createElement({ type: "rectangle", x: 100, y: 100, id: "rect" }),
    ]);
    UI.createElement("freedraw", { x: 0, y: 0 });
    expect(h.elements.map((e) => e.type)).toEqual(["rectangle", "freedraw"]);
  });
});

describe("laserPointerOptions prop", () => {
  it("reads the look when a laser stroke starts", async () => {
    let settings: LaserPointerSettings | null = null;
    await render(<Excalidraw laserPointerOptions={() => settings} />);
    const trails = h.app.laserTrails;
    const optionsOf = () =>
      (trails.localTrail as unknown as { options: { size: number } }).options;

    trails.startPath(1, 1);
    expect(optionsOf().size).toBe(2);
    trails.endPath();

    settings = { color: "#00ff00", size: 9, decayMs: 300, length: 10 };
    trails.startPath(1, 1);
    expect(optionsOf().size).toBe(9);
    trails.endPath();
    trails.stop();
  });
});
