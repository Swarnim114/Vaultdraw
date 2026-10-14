import { act } from "@testing-library/react";
import React from "react";

import { setDisplayColorTransform } from "@excalidraw/common";

import { isLibraryMenuOpenAtom } from "../components/LibraryMenu";
import { editorJotaiStore } from "../editor-jotai";
import { Excalidraw } from "../index";

import { API } from "./helpers/api";
import { render, waitFor } from "./test-utils";

import type { LibraryItem } from "../types";

const { h } = window;

const STROKE = "#1e1e1e";

const item: LibraryItem = {
  id: "a",
  status: "unpublished",
  created: 1,
  elements: [
    API.createElement({
      type: "rectangle",
      id: "el-a",
      strokeColor: STROKE,
      backgroundColor: "transparent",
    }),
  ],
};

const openLibrary = async (theme: "light" | "dark") => {
  const { container } = await render(<Excalidraw theme={theme} />);
  await act(() =>
    h.app.library.updateLibrary({
      libraryItems: [item],
      openLibraryMenu: true,
    }),
  );
  return container;
};

const strokes = (container: Element) =>
  Array.from(container.querySelectorAll(".library-unit svg [stroke]"))
    .map((el) => el.getAttribute("stroke")!.toLowerCase())
    .filter((stroke) => stroke !== "none");

const previewStrokes = async (container: Element) => {
  await waitFor(() => expect(strokes(container).length).toBeGreaterThan(0));
  return strokes(container);
};

describe("library preview colours", () => {
  beforeEach(() => {
    editorJotaiStore.set(isLibraryMenuOpenAtom, false);
  });
  afterEach(() => {
    setDisplayColorTransform(null);
  });

  it("uses the element colours in the light theme", async () => {
    const container = await openLibrary("light");
    expect(await previewStrokes(container)).toContain(STROKE);
  });

  it("uses dark-mode colours in the dark theme", async () => {
    const container = await openLibrary("dark");
    const found = await previewStrokes(container);
    expect(found).not.toContain(STROKE);
  });

  it("does not use a CSS filter on the preview", async () => {
    const container = await openLibrary("dark");
    await previewStrokes(container);
    const preview = container.querySelector(".library-unit svg") as HTMLElement;
    expect(preview.style.filter).toBe("");
  });

  it("uses the host display colour transform and follows its changes", async () => {
    const container = await openLibrary("light");
    expect(await previewStrokes(container)).toContain(STROKE);

    await act(async () => {
      setDisplayColorTransform((color) =>
        color.toLowerCase() === STROKE ? "#ff00aa" : color,
      );
    });
    await waitFor(async () =>
      expect(await previewStrokes(container)).toContain("#ff00aa"),
    );
    expect(await previewStrokes(container)).not.toContain(STROKE);

    await act(async () => {
      setDisplayColorTransform((color) =>
        color.toLowerCase() === STROKE ? "#00aaff" : color,
      );
    });
    await waitFor(async () => {
      const found = await previewStrokes(container);
      expect(found).toContain("#00aaff");
      expect(found).not.toContain("#ff00aa");
    });

    await act(async () => {
      setDisplayColorTransform(null);
    });
    await waitFor(async () =>
      expect(await previewStrokes(container)).toContain(STROKE),
    );
  });

  it("re-installing the same transform keeps the rendered previews", async () => {
    const transform = (color: string) =>
      color.toLowerCase() === STROKE ? "#ff00aa" : color;
    setDisplayColorTransform(transform, "#101010");
    const container = await openLibrary("light");
    await waitFor(async () =>
      expect(await previewStrokes(container)).toContain("#ff00aa"),
    );
    const svg = container.querySelector(".library-unit svg");
    await act(async () => {
      setDisplayColorTransform(transform, "#101010");
    });
    expect(await previewStrokes(container)).toContain("#ff00aa");
    expect(container.querySelector(".library-unit svg")?.outerHTML).toBe(
      svg?.outerHTML,
    );
  });

  it("re-renders a cached preview when the item's elements change", async () => {
    const container = await openLibrary("light");
    expect(await previewStrokes(container)).toContain(STROKE);
    const changed = API.createElement({
      type: "rectangle",
      id: "el-a",
      strokeColor: "#e03131",
      backgroundColor: "transparent",
    });
    await act(() =>
      h.app.library.updateLibrary({
        libraryItems: [{ ...item, elements: [changed] }],
        merge: false,
      }),
    );
    await waitFor(async () => {
      const found = await previewStrokes(container);
      expect(found).toContain("#e03131");
      expect(found).not.toContain(STROKE);
    });
  });
});
