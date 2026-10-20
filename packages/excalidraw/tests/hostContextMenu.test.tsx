import React from "react";
import { vi } from "vitest";

import { randomId, reseed } from "@excalidraw/common";

import type { FileId } from "@excalidraw/element/types";

import * as blobModule from "../data/blob";
import { Excalidraw } from "../index";

import { API } from "./helpers/api";
import { mockMultipleHTMLImageElements } from "./helpers/mocks";
import { UI } from "./helpers/ui";
import {
  GlobalTestState,
  fireEvent,
  render,
  unmountComponent,
  waitFor,
} from "./test-utils";
import { DEER_IMAGE_DIMENSIONS } from "./fixtures/constants";

import type { ExcalidrawImperativeAPI } from "../types";

// Vaultdraw: host items in the empty-canvas context menu, and
// api.insertImages (used by the desktop "Import file…").

unmountComponent();

const { h } = window;

describe("canvasContextMenuItems", () => {
  beforeEach(() => reseed(7));

  it("adds the host's items after Paste, with the right-clicked scene point", async () => {
    const onSelect = vi.fn();
    const items = vi.fn(() => [
      {
        name: "host-import",
        label: "Import file…",
        shortcut: "Cmd+I",
        onSelect,
      },
    ]);
    await render(<Excalidraw canvasContextMenuItems={items} />);

    fireEvent.contextMenu(GlobalTestState.interactiveCanvas, {
      button: 2,
      clientX: 40,
      clientY: 30,
    });
    const menu = UI.queryContextMenu()!;
    const names = Array.from(menu.querySelectorAll("li[data-testid]")).map(
      (li) => li.getAttribute("data-testid"),
    );
    expect(names.slice(0, 2)).toEqual(["paste", "host-import"]);
    expect(items).toHaveBeenCalledWith({
      x: 40 - h.state.offsetLeft - h.state.scrollX,
      y: 30 - h.state.offsetTop - h.state.scrollY,
    });
    const item = menu.querySelector("[data-testid=host-import]")!;
    expect(item.textContent).toContain("Import file…");
    expect(item.textContent).toContain("Cmd+I");

    fireEvent.click(item);
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(UI.queryContextMenu()).toBeNull();
  });

  it("is not asked for an element's context menu", async () => {
    const items = vi.fn(() => []);
    await render(<Excalidraw canvasContextMenuItems={items} />);
    UI.createElement("rectangle", { x: 10, y: 10, width: 50, height: 50 });
    fireEvent.contextMenu(GlobalTestState.interactiveCanvas, {
      button: 2,
      clientX: 30,
      clientY: 30,
    });
    expect(UI.queryContextMenu()).not.toBeNull();
    expect(items).not.toHaveBeenCalled();
  });
});

describe("api.insertImages", () => {
  beforeEach(() => {
    reseed(7);
    vi.spyOn(blobModule, "generateIdFromFile").mockImplementation(() =>
      Promise.resolve(randomId() as FileId),
    );
    vi.spyOn(blobModule, "resizeImageFile").mockImplementation((file: File) =>
      Promise.resolve(file),
    );
  });

  it("inserts image files centred on a scene point; ignores other files", async () => {
    let api: ExcalidrawImperativeAPI | null = null;
    await render(<Excalidraw onExcalidrawAPI={(a) => (api = a)} />);
    // jsdom has no layout; image sizing is capped by the viewport height.
    h.state.height = 1000;
    mockMultipleHTMLImageElements([
      [DEER_IMAGE_DIMENSIONS.width, DEER_IMAGE_DIMENSIONS.height],
    ]);
    const deer = await API.loadFile("./fixtures/deer.png");
    const text = new File(["x"], "notes.txt", { type: "text/plain" });

    await api!.insertImages([text, deer], { x: 500, y: 400 });

    await waitFor(() => {
      expect(h.elements).toHaveLength(1);
      expect(h.elements[0]).toMatchObject({
        type: "image",
        ...DEER_IMAGE_DIMENSIONS,
      });
    });
    const [img] = h.elements;
    expect(img.x + img.width / 2).toBeCloseTo(500, 0);
    expect(img.y + img.height / 2).toBeCloseTo(400, 0);
  });
});
