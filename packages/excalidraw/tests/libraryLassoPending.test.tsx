import { act } from "@testing-library/react";
import React from "react";

import { isLibraryMenuOpenAtom } from "../components/LibraryMenu";
import { editorJotaiStore } from "../editor-jotai";
import { Excalidraw } from "../index";

import { API } from "./helpers/api";
import { render, waitFor } from "./test-utils";

const { h } = window;

/**
 * The library offers the selection as a pending "add" tile. The lasso is a
 * selection tool too (and the default one in the phone layout, which narrow
 * desktop windows get), so a selection made while it is active must be
 * offered as well.
 */
describe("library pending tile", () => {
  beforeEach(() => {
    editorJotaiStore.set(isLibraryMenuOpenAtom, false);
  });

  it.each(["selection", "lasso"] as const)(
    "follows the selection while the %s tool is active",
    async (tool) => {
      const { container } = await render(<Excalidraw />);
      await act(() =>
        h.app.library.updateLibrary({
          libraryItems: [],
          openLibraryMenu: true,
        }),
      );
      await waitFor(() =>
        expect(container.querySelector(".layer-ui__library")).not.toBeNull(),
      );
      const rect = API.createElement({ type: "rectangle", id: "r1" });
      await act(() => {
        h.app.setActiveTool({ type: tool });
        h.elements = [rect];
        API.setSelectedElements([rect]);
      });
      expect(h.state.activeTool.type).toBe(tool);
      await waitFor(() =>
        expect(container.querySelector(".library-unit__pulse")).not.toBeNull(),
      );
    },
  );
});
