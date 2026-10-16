import { Excalidraw } from "../index";
import { actionWrapTextInContainer } from "../actions/actionBoundText";

import { API } from "./helpers/api";
import { act, render, unmountComponent } from "./test-utils";

import type { NewContainerStyle } from "../types";

unmountComponent();

const { h } = window;

describe("newContainerStyle prop", () => {
  let style: NewContainerStyle | null = null;

  beforeEach(async () => {
    style = null;
    await render(<Excalidraw newContainerStyle={() => style} />);
  });

  const wrap = () => {
    const text = API.createElement({ type: "text", text: "hi", x: 0, y: 0 });
    API.setElements([text]);
    API.setSelectedElements([text]);
    act(() => {
      h.app.actionManager.executeAction(actionWrapTextInContainer);
    });
    return h.elements.find((el) => el.type === "rectangle")!;
  };

  it("keeps the current-item style when the host returns null", () => {
    const rect = wrap();
    expect(rect.strokeColor).toBe(h.state.currentItemStrokeColor);
    expect(rect.backgroundColor).toBe(h.state.currentItemBackgroundColor);
  });

  it("applies the host's style to the container", () => {
    style = {
      strokeColor: "#e03131",
      backgroundColor: "#ffec99",
      fillStyle: "solid",
      strokeWidth: 4,
      opacity: 70,
      roundness: "sharp",
    };
    const rect = wrap();
    expect(rect).toMatchObject({
      strokeColor: "#e03131",
      backgroundColor: "#ffec99",
      fillStyle: "solid",
      strokeWidth: 4,
      opacity: 70,
      roundness: null,
    });
  });
});
