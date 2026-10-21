import { act } from "@testing-library/react";
import React from "react";

import type { FileId } from "@excalidraw/element/types";

import { isLibraryMenuOpenAtom } from "../components/LibraryMenu";
import { collectLibraryItemsFiles, getLibraryItemFiles } from "../data/library";
import { editorJotaiStore } from "../editor-jotai";
import { Excalidraw } from "../index";

import { API } from "./helpers/api";
import { render, waitFor } from "./test-utils";

import type { BinaryFileData, LibraryItem } from "../types";

const { h } = window;

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="10"><rect width="20" height="10"/></svg>`;
const fileId = "file-1" as FileId;
const file: BinaryFileData = {
  id: fileId,
  mimeType: "image/svg+xml",
  dataURL: `data:image/svg+xml;base64,${btoa(
    SVG,
  )}` as BinaryFileData["dataURL"],
  created: 1,
};

const image = () =>
  API.createElement({
    type: "image",
    id: "img",
    fileId,
    width: 20,
    height: 10,
  });

describe("library items with images", () => {
  beforeEach(() => {
    editorJotaiStore.set(isLibraryMenuOpenAtom, false);
  });

  it("getLibraryItemFiles keeps only the files of the elements' images", () => {
    const files = { [fileId]: file, other: { ...file, id: "other" } } as any;
    expect(getLibraryItemFiles([image()], files)).toEqual({ [fileId]: file });
    expect(getLibraryItemFiles([image()], {})).toBeUndefined();
    expect(
      getLibraryItemFiles([API.createElement({ type: "rectangle" })], files),
    ).toBeUndefined();
  });

  it("collectLibraryItemsFiles merges the files of several items", () => {
    const a = { files: { a: file } } as unknown as LibraryItem;
    const b = { files: { b: file } } as unknown as LibraryItem;
    expect(collectLibraryItemsFiles([a, b, {} as LibraryItem])).toEqual({
      a: file,
      b: file,
    });
    expect(collectLibraryItemsFiles([{} as LibraryItem])).toBeNull();
  });

  it("the panel previews the image, and inserting registers its file", async () => {
    const { container } = await render(<Excalidraw />);
    const item: LibraryItem = {
      id: "a",
      status: "unpublished",
      created: 1,
      elements: [image()],
      files: { [fileId]: file },
    };
    await act(() =>
      h.app.library.updateLibrary({
        libraryItems: [item],
        openLibraryMenu: true,
      }),
    );
    // the exported preview embeds the image data
    await waitFor(() =>
      expect(
        container.querySelector(
          ".library-unit svg image, .library-unit svg use",
        ),
      ).not.toBeNull(),
    );
    expect(container.querySelector(".library-unit svg")!.outerHTML).toContain(
      "data:image/svg+xml",
    );

    expect(h.app.files[fileId]).toBeUndefined();
    act(() => {
      h.app.onInsertElements([image()], collectLibraryItemsFiles([item]));
    });
    await waitFor(() => expect(h.app.files[fileId]).toBeTruthy());
  });
});
