import { Excalidraw } from "../index";

import { UI } from "./helpers/ui";
import { act, render } from "./test-utils";

const { h } = window;

describe("currentItemStrokeWidth prop", () => {
  let width: number | null = null;

  beforeEach(async () => {
    width = null;
    await render(<Excalidraw currentItemStrokeWidth={() => width} />);
  });

  afterEach(async () => {
    await act(async () => {});
  });

  it("uses the width key when the host returns null", () => {
    UI.createElement("rectangle", { x: 0, y: 0 });
    UI.createElement("arrow", { x: 100, y: 100 });
    expect(h.elements.map((el) => el.strokeWidth)).toEqual([2, 2]);
  });

  it("applies the host's width to new rectangles and arrows", () => {
    width = 3;
    UI.createElement("rectangle", { x: 0, y: 0 });
    UI.createElement("arrow", { x: 100, y: 100 });
    expect(h.elements.map((el) => el.strokeWidth)).toEqual([3, 3]);
  });
});
