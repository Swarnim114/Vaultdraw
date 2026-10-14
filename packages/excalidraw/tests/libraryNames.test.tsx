import { act, queryByTestId } from "@testing-library/react";
import React from "react";
import { vi } from "vitest";

import { isLibraryMenuOpenAtom } from "../components/LibraryMenu";
import { withLibraryItemName } from "../components/LibraryMenuItems";
import {
  LIBRARY_ITEM_NAME_MAX_LENGTH,
  getHoverPreviewPosition,
} from "../components/LibraryUnit";
import { useHandleLibrary } from "../data/library";
import { editorJotaiStore } from "../editor-jotai";
import { Excalidraw } from "../index";

import { API } from "./helpers/api";
import { fireEvent, render, waitFor } from "./test-utils";

import type {
  LibraryPersistedData,
  LibraryPersistenceAdapter,
} from "../data/library";
import type {
  ExcalidrawImperativeAPI,
  LibraryItem,
  LibraryUIOptions,
} from "../types";

const { h } = window;

const makeItem = (id: string, name?: string, text?: string): LibraryItem => ({
  id,
  ...(name !== undefined ? { name } : {}),
  status: "unpublished",
  created: 1,
  elements: [
    API.createElement({ type: "rectangle", id: `el-${id}` }),
    ...(text
      ? [API.createElement({ type: "text", id: `txt-${id}`, text })]
      : []),
  ],
});

const NAMED: LibraryUIOptions = { online: false, namedItems: true };

const openLibrary = async (
  options: LibraryUIOptions | undefined,
  items: LibraryItem[],
) => {
  const { container } = await render(<Excalidraw libraryUIOptions={options} />);
  await act(() =>
    h.app.library.updateLibrary({
      libraryItems: items,
      openLibraryMenu: true,
    }),
  );
  await waitFor(() =>
    expect(container.querySelector(".layer-ui__library")).not.toBeNull(),
  );
  return container;
};

const nameEls = (container: Element) =>
  Array.from(
    container.querySelectorAll('[data-testid="library-item-name"]'),
  ) as HTMLElement[];

const nameInput = (container: Element) =>
  container.querySelector(
    '[data-testid="library-item-name-input"]',
  ) as HTMLInputElement | null;

const latest = () => h.app.library.getLatestLibrary();

const startRename = async (container: Element, index = 0) => {
  await waitFor(() => expect(nameEls(container).length).toBeGreaterThan(index));
  fireEvent.doubleClick(nameEls(container)[index]);
  return waitFor(() => {
    const input = nameInput(container);
    expect(input).not.toBeNull();
    return input!;
  });
};

const type = (input: HTMLInputElement, value: string) =>
  fireEvent.change(input, { target: { value } });

const addPending = async () => {
  const rect = API.createElement({ type: "rectangle", id: "pending" });
  await act(() => {
    h.elements = [rect];
    API.setSelectedElements([rect]);
  });
};

const search = async (container: Element, query: string) => {
  const input = container.querySelector(
    ".library-menu-items-container__search input",
  ) as HTMLInputElement;
  fireEvent.change(input, { target: { value: query } });
};

describe("library item names", () => {
  beforeEach(() => {
    editorJotaiStore.set(isLibraryMenuOpenAtom, false);
  });

  describe("display", () => {
    it("shows names and 'Untitled' with namedItems", async () => {
      const container = await openLibrary(NAMED, [
        makeItem("a", "Flowchart"),
        makeItem("b"),
        makeItem("c", "   "),
      ]);
      await waitFor(() => expect(nameEls(container)).toHaveLength(3));
      const els = nameEls(container);
      expect(els.map((el) => el.textContent)).toEqual([
        "Flowchart",
        "Untitled",
        "Untitled",
      ]);
      expect(els[0].classList).not.toContain("library-unit__name--untitled");
      expect(els[1].classList).toContain("library-unit__name--untitled");
      expect(els[2].classList).toContain("library-unit__name--untitled");
    });

    it("keeps the upstream layout without namedItems", async () => {
      const container = await openLibrary({ online: false }, [
        makeItem("a", "Flowchart"),
        makeItem("b"),
      ]);
      await waitFor(() =>
        expect(container.querySelectorAll(".library-unit__active").length).toBe(
          2,
        ),
      );
      expect(nameEls(container)).toHaveLength(0);
      expect(container.querySelector(".library-unit--named")).toBeNull();
      expect(container.textContent).not.toContain("Untitled");
      // double-click does nothing
      fireEvent.doubleClick(container.querySelector(".library-unit__dragger")!);
      expect(nameInput(container)).toBeNull();
    });

    it("keeps the upstream layout with no libraryUIOptions", async () => {
      const container = await openLibrary(undefined, [makeItem("a", "X")]);
      await waitFor(() =>
        expect(container.querySelectorAll(".library-unit__active").length).toBe(
          1,
        ),
      );
      expect(nameEls(container)).toHaveLength(0);
    });
  });

  describe("rename", () => {
    it("double-click renames the item and keeps its other data", async () => {
      const container = await openLibrary(NAMED, [makeItem("a", "Old")]);
      const input = await startRename(container);
      expect(input.value).toBe("Old");
      type(input, "  New name  ");
      fireEvent.keyDown(input, { key: "Enter" });
      await waitFor(() => expect(nameInput(container)).toBeNull());
      await waitFor(async () => {
        expect((await latest())[0].name).toBe("New name");
      });
      const [item] = await latest();
      expect(item.id).toBe("a");
      expect(item.elements).toHaveLength(1);
      expect(nameEls(container)[0].textContent).toBe("New name");
    });

    it("blur commits", async () => {
      const container = await openLibrary(NAMED, [makeItem("a")]);
      const input = await startRename(container);
      expect(input.value).toBe("");
      type(input, "Blurred");
      fireEvent.blur(input);
      await waitFor(async () => {
        expect((await latest())[0].name).toBe("Blurred");
      });
    });

    it("Escape cancels without changing the item", async () => {
      const container = await openLibrary(NAMED, [makeItem("a", "Keep")]);
      const input = await startRename(container);
      type(input, "Discard");
      fireEvent.keyDown(input, { key: "Escape" });
      await waitFor(() => expect(nameInput(container)).toBeNull());
      // the blur that follows unmounting must not commit
      expect((await latest())[0].name).toBe("Keep");
      expect(nameEls(container)[0].textContent).toBe("Keep");
    });

    it("an empty name removes the name key", async () => {
      const container = await openLibrary(NAMED, [makeItem("a", "Gone")]);
      const input = await startRename(container);
      type(input, "   ");
      fireEvent.keyDown(input, { key: "Enter" });
      await waitFor(async () => {
        expect(await latest()).toHaveLength(1);
        expect("name" in (await latest())[0]).toBe(false);
      });
      await waitFor(() =>
        expect(nameEls(container)[0].textContent).toBe("Untitled"),
      );
    });

    it("limits the input length", async () => {
      const container = await openLibrary(NAMED, [makeItem("a")]);
      const input = await startRename(container);
      expect(input.maxLength).toBe(LIBRARY_ITEM_NAME_MAX_LENGTH);
    });

    it("an unchanged name does not touch the library", async () => {
      const container = await openLibrary(NAMED, [makeItem("a", "Same")]);
      const before = await latest();
      const input = await startRename(container);
      fireEvent.keyDown(input, { key: "Enter" });
      await waitFor(() => expect(nameInput(container)).toBeNull());
      expect(await latest()).toEqual(before);
    });

    it("the rename is saved through the persistence adapter", async () => {
      const saves: LibraryPersistedData[] = [];
      const adapter: LibraryPersistenceAdapter = {
        load: () => ({ libraryItems: [makeItem("a", "Old")], restored: true }),
        save: (data) => {
          saves.push(data);
        },
      };
      const Host = () => {
        const [api, setApi] = React.useState<ExcalidrawImperativeAPI | null>(
          null,
        );
        useHandleLibrary({ excalidrawAPI: api, adapter });
        return (
          <Excalidraw
            libraryUIOptions={NAMED}
            onExcalidrawAPI={(a) => setApi(a)}
          />
        );
      };
      const { container } = await render(<Host />);
      await waitFor(async () => expect(await latest()).toHaveLength(1));
      await act(async () =>
        h.app.library.updateLibrary({
          libraryItems: await latest(),
          openLibraryMenu: true,
        }),
      );
      await waitFor(() => expect(nameEls(container)).toHaveLength(1));
      const before = saves.length;

      const input = await startRename(container);
      type(input, "Renamed");
      fireEvent.keyDown(input, { key: "Enter" });
      await waitFor(() => expect(saves).toHaveLength(before + 1));
      expect(saves[before].libraryItems.map((i) => [i.id, i.name])).toEqual([
        ["a", "Renamed"],
      ]);
    });

    it("the dropdown has Rename for exactly one selected item", async () => {
      const container = await openLibrary(NAMED, [
        makeItem("a", "A"),
        makeItem("b", "B"),
      ]);
      const draggers = () =>
        container.querySelectorAll(".library-unit__dragger");
      const openDropdown = () =>
        fireEvent.click(
          queryByTestId(
            container.querySelector(".layer-ui__library")!,
            "dropdown-menu-button",
          )!,
        );

      fireEvent.click(draggers()[0], { shiftKey: true });
      await waitFor(() =>
        expect(
          container.querySelectorAll(".library-unit--selected"),
        ).toHaveLength(1),
      );
      openDropdown();
      fireEvent.click(queryByTestId(container, "lib-dropdown--rename")!);
      const input = await waitFor(() => {
        const el = nameInput(container);
        expect(el).not.toBeNull();
        return el!;
      });
      expect(input.value).toBe("A");
      type(input, "Alpha");
      fireEvent.keyDown(input, { key: "Enter" });
      await waitFor(async () => {
        expect((await latest()).find((i) => i.id === "a")!.name).toBe("Alpha");
      });
    });

    it("the dropdown has no Rename with two selected items", async () => {
      const container = await openLibrary(NAMED, [
        makeItem("a", "A"),
        makeItem("b", "B"),
      ]);
      const draggers = container.querySelectorAll(".library-unit__dragger");
      fireEvent.click(draggers[0], { shiftKey: true });
      fireEvent.click(draggers[1], { shiftKey: true });
      await waitFor(() =>
        expect(
          container.querySelectorAll(".library-unit--selected"),
        ).toHaveLength(2),
      );
      fireEvent.click(
        queryByTestId(
          container.querySelector(".layer-ui__library")!,
          "dropdown-menu-button",
        )!,
      );
      expect(queryByTestId(container, "lib-dropdown--rename")).toBeNull();
    });

    it("no Rename in the dropdown without namedItems", async () => {
      const container = await openLibrary({ online: false }, [makeItem("a")]);
      fireEvent.click(container.querySelector(".library-unit__dragger")!, {
        shiftKey: true,
      });
      await waitFor(() =>
        expect(container.querySelector(".library-unit--selected")).not.toBe(
          null,
        ),
      );
      fireEvent.click(
        queryByTestId(
          container.querySelector(".layer-ui__library")!,
          "dropdown-menu-button",
        )!,
      );
      expect(queryByTestId(container, "lib-dropdown--rename")).toBeNull();
    });

    it("right-click selects the tile", async () => {
      const container = await openLibrary(NAMED, [
        makeItem("a", "A"),
        makeItem("b", "B"),
      ]);
      fireEvent.contextMenu(
        container.querySelectorAll(".library-unit__active")[1],
      );
      await waitFor(() => {
        const selected = container.querySelectorAll(".library-unit--selected");
        expect(selected).toHaveLength(1);
        expect(selected[0].getAttribute("data-testid")).toBe("library-unit-b");
      });
    });
  });

  describe("adding from the pending tile", () => {
    it("opens the name input and names the new item", async () => {
      const container = await openLibrary(NAMED, [makeItem("a", "Existing")]);
      await addPending();
      const adder = await waitFor(() => {
        const el = container.querySelector(".library-unit__adder");
        expect(el).not.toBeNull();
        return el!;
      });
      expect(nameInput(container)).toBeNull();
      fireEvent.click(
        adder
          .closest(".library-unit")!
          .querySelector(".library-unit__dragger")!,
      );
      const input = await waitFor(() => {
        const el = nameInput(container);
        expect(el).not.toBeNull();
        return el!;
      });
      await waitFor(() => expect(document.activeElement).toBe(input));
      type(input, "Fresh");
      fireEvent.keyDown(input, { key: "Enter" });
      await waitFor(async () => {
        const items = await latest();
        expect(items).toHaveLength(2);
        expect(items.map((i) => i.name).sort()).toEqual(["Existing", "Fresh"]);
      });
      // the newly added item is the one that got the name
      expect((await latest())[0].name).toBe("Fresh");
    });

    it("leaving the new item's name empty keeps it unnamed", async () => {
      const container = await openLibrary(NAMED, []);
      await addPending();
      const adder = await waitFor(() => {
        const el = container.querySelector(".library-unit__adder");
        expect(el).not.toBeNull();
        return el!;
      });
      fireEvent.click(
        adder
          .closest(".library-unit")!
          .querySelector(".library-unit__dragger")!,
      );
      const input = await waitFor(() => {
        const el = nameInput(container);
        expect(el).not.toBeNull();
        return el!;
      });
      fireEvent.keyDown(input, { key: "Enter" });
      await waitFor(async () => expect(await latest()).toHaveLength(1));
      expect("name" in (await latest())[0]).toBe(false);
    });
  });

  describe("search", () => {
    const items = () => [
      makeItem("a", "Network Diagram"),
      makeItem("b", undefined, "Héllo World"),
      makeItem("c"),
      makeItem("d", "Other", "inner secret"),
    ];

    const visibleIds = (container: Element) =>
      Array.from(container.querySelectorAll(".library-unit__active")).map(
        (el) => el.getAttribute("data-testid"),
      );

    it("matches by name, case-insensitively", async () => {
      const container = await openLibrary(NAMED, items());
      await search(container, "NETWORK");
      await waitFor(() =>
        expect(visibleIds(container)).toEqual(["library-unit-a"]),
      );
    });

    it("matches by the text inside the item, ignoring accents", async () => {
      const container = await openLibrary(NAMED, items());
      await search(container, "hello");
      await waitFor(() =>
        expect(visibleIds(container)).toEqual(["library-unit-b"]),
      );
      await search(container, "SECRET");
      await waitFor(() =>
        expect(visibleIds(container)).toEqual(["library-unit-d"]),
      );
    });

    it("does not match unnamed items without text", async () => {
      const container = await openLibrary(NAMED, items());
      await search(container, "untitled");
      await waitFor(() => expect(visibleIds(container)).toEqual([]));
      await search(container, "rectangle");
      await waitFor(() => expect(visibleIds(container)).toEqual([]));
    });
  });

  describe("helpers", () => {
    it("withLibraryItemName trims, caps and removes empty names", () => {
      const item = makeItem("a", "Old");
      expect(withLibraryItemName(item, "  New ").name).toBe("New");
      expect(withLibraryItemName(item, "x".repeat(500)).name).toHaveLength(
        LIBRARY_ITEM_NAME_MAX_LENGTH,
      );
      const cleared = withLibraryItemName(item, "   ");
      expect("name" in cleared).toBe(false);
      expect(cleared.id).toBe("a");
      expect(cleared.elements).toBe(item.elements);
      // input item is not mutated
      expect(item.name).toBe("Old");
      // naming an unnamed item
      expect(withLibraryItemName(makeItem("b"), "N").name).toBe("N");
    });

    describe("getHoverPreviewPosition", () => {
      const size = 240;
      const gap = 12;
      const container = { left: 100, right: 700, top: 50, bottom: 650 };
      type Rect = { left: number; right: number; top: number; height: number };
      const tileAt = (left: number, top: number): Rect => ({
        left,
        right: left + 100,
        top,
        height: 100,
      });
      const overlaps = (pos: { left: number; top: number }, tile: Rect) => {
        // pos is relative to the container
        const l = pos.left + container.left;
        const t = pos.top + container.top;
        return (
          l < tile.right &&
          l + size > tile.left &&
          t < tile.top + tile.height &&
          t + size > tile.top
        );
      };

      it("goes to the left of the tile when there is room", () => {
        const tile = tileAt(500, 300);
        const pos = getHoverPreviewPosition(tile, container);
        expect(pos.left + container.left).toBe(tile.left - gap - size);
        // centred on the tile
        expect(pos.top + container.top).toBe(300 + 50 - size / 2);
        expect(overlaps(pos, tile)).toBe(false);
      });

      it("falls back to the right when there is no room on the left", () => {
        const tile = tileAt(110, 300);
        const pos = getHoverPreviewPosition(tile, container);
        expect(pos.left + container.left).toBe(tile.right + gap);
        expect(overlaps(pos, tile)).toBe(false);
      });

      it("clamps vertically inside the container", () => {
        const top = getHoverPreviewPosition(tileAt(500, 50), container);
        expect(top.top).toBe(8);
        const bottom = getHoverPreviewPosition(tileAt(500, 600), container);
        expect(bottom.top).toBe(container.bottom - container.top - size - 8);
      });

      it("never overlaps the tile across positions", () => {
        for (let left = 100; left <= 600; left += 25) {
          for (let top = 50; top <= 550; top += 50) {
            const tile = tileAt(left, top);
            const pos = getHoverPreviewPosition(tile, container);
            if (
              left + 100 + gap + size <= container.right ||
              left - gap - size >= container.left
            ) {
              expect(overlaps(pos, tile)).toBe(false);
            }
          }
        }
      });

      it("honours a custom size", () => {
        const tile = tileAt(500, 300);
        const pos = getHoverPreviewPosition(tile, container, 100);
        expect(pos.left + container.left).toBe(tile.left - gap - 100);
      });
    });
  });

  it("renders the hover preview after a delay", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const container = await openLibrary(NAMED, [makeItem("a", "A")]);
      await waitFor(() =>
        expect(
          container.querySelector(".library-unit__preview svg"),
        ).not.toBeNull(),
      );
      const dragger = container.querySelector(".library-unit__dragger")!;
      fireEvent.pointerEnter(dragger);
      expect(queryByTestId(container, "library-item-hover-preview")).toBeNull();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(600);
      });
      await waitFor(() =>
        expect(
          document.querySelector('[data-testid="library-item-hover-preview"]'),
        ).not.toBeNull(),
      );
      fireEvent.pointerLeave(dragger);
      await waitFor(() =>
        expect(
          document.querySelector('[data-testid="library-item-hover-preview"]'),
        ).toBeNull(),
      );
    } finally {
      vi.useRealTimers();
    }
  });
});
