import { act, queryByTestId } from "@testing-library/react";
import React from "react";
import { vi } from "vitest";

import { MIME_TYPES } from "@excalidraw/common";

import { isLibraryMenuOpenAtom } from "../components/LibraryMenu";
import { serializeLibraryAsJSON } from "../data/json";
import { editorJotaiStore } from "../editor-jotai";
import { Excalidraw } from "../index";

import { API } from "./helpers/api";
import { fireEvent, render, waitFor } from "./test-utils";

import type { LibraryItem, LibraryUIOptions } from "../types";

const { h } = window;

const makeItem = (id: string): LibraryItem => ({
  id,
  name: id,
  status: "unpublished",
  created: 1,
  elements: [API.createElement({ type: "rectangle", id: `el-${id}` })],
});

const createOptions = (
  assignments: Record<string, string>,
  overrides: Partial<LibraryUIOptions> = {},
) => {
  const assign = vi.fn((ids: readonly string[], sectionId: string) => {
    ids.forEach((id) => (assignments[id] = sectionId));
  });
  const options: LibraryUIOptions = {
    online: false,
    sections: {
      list: [
        { id: "personal", label: "Personal" },
        { id: "vault", label: "This vault", emptyHint: "Nothing in vault" },
        { id: "ro", label: "Read only", canAdd: false },
      ],
      sectionOf: (id) => assignments[id] ?? "personal",
      assign,
    },
    ...overrides,
  };
  return { options, assign };
};

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

const unitIds = (container: Element) =>
  Array.from(container.querySelectorAll(".library-unit")).map(
    (el) => el.getAttribute("data-testid") || "",
  );

const openDropdown = (container: Element) => {
  fireEvent.click(
    queryByTestId(
      container.querySelector(".layer-ui__library")!,
      "dropdown-menu-button",
    )!,
  );
};

const selectItem = async (container: Element, index: number) => {
  const draggers = container.querySelectorAll(".library-unit__dragger");
  fireEvent.click(draggers[index], { shiftKey: true });
  await waitFor(() =>
    expect(container.querySelector(".library-unit--selected")).not.toBe(null),
  );
};

const addPending = async () => {
  const rect = API.createElement({ type: "rectangle", id: "pending" });
  await act(() => {
    h.elements = [rect];
    API.setSelectedElements([rect]);
  });
};

describe("library sections", () => {
  beforeEach(() => {
    editorJotaiStore.set(isLibraryMenuOpenAtom, false);
  });

  it("renders a header and items per section in list order", async () => {
    const assignments = { a: "vault", b: "personal", c: "vault" };
    const { options } = createOptions(assignments);
    const container = await openLibrary(options, [
      makeItem("a"),
      makeItem("b"),
      makeItem("c"),
    ]);

    const headers = Array.from(
      container.querySelectorAll(".library-menu-items-container__header"),
    ).map((el) => el.textContent);
    expect(headers).toEqual(["Personal", "This vault", "Read only"]);

    const personal = container.querySelector(
      '[data-testid="library-section-personal"]',
    )!;
    expect(personal).not.toBeNull();
    await waitFor(() =>
      expect(container.querySelectorAll(".library-unit").length).toBe(3),
    );
    // empty section shows its hint, default hint for the others
    expect(container.textContent).toContain("Select an item on canvas");
  });

  it("shows the empty hint of an empty section", async () => {
    const { options } = createOptions({ a: "personal" });
    const container = await openLibrary(options, [makeItem("a")]);
    expect(container.textContent).toContain("Nothing in vault");
  });

  it("add tile per addable section assigns before adding", async () => {
    const assignments: Record<string, string> = {};
    const { options, assign } = createOptions(assignments);
    const container = await openLibrary(options, [makeItem("a")]);
    await addPending();

    const tiles = await waitFor(() => {
      const found = container.querySelectorAll(".library-unit__adder");
      expect(found.length).toBe(2);
      return found;
    });

    fireEvent.click(
      tiles[1]
        .closest(".library-unit")!
        .querySelector(".library-unit__dragger")!,
    );
    await waitFor(() => expect(assign).toHaveBeenCalledTimes(1));
    const [ids, sectionId] = assign.mock.calls[0];
    expect(sectionId).toBe("vault");
    expect(ids.length).toBe(1);
    await waitFor(async () => {
      const latest = await h.app.library.getLatestLibrary();
      expect(latest.length).toBe(2);
      expect(latest[0].id).toBe(ids[0]);
    });
  });

  it("moves selected items via assign and re-renders", async () => {
    const assignments: Record<string, string> = { a: "personal" };
    const { options, assign } = createOptions(assignments);
    const container = await openLibrary(options, [makeItem("a")]);
    await selectItem(container, 0);
    openDropdown(container);

    expect(queryByTestId(container, "lib-dropdown--move-personal")).toBeNull();
    expect(queryByTestId(container, "lib-dropdown--move-ro")).toBeNull();
    fireEvent.click(queryByTestId(container, "lib-dropdown--move-vault")!);

    expect(assign).toHaveBeenCalledWith(["a"], "vault");
    await waitFor(() => {
      const vaultHeader = container.querySelector(
        '[data-testid="library-section-vault"]',
      )!;
      expect(vaultHeader).not.toBeNull();
      expect(container.textContent).not.toContain("Nothing in vault");
    });
  });

  it("copies selected items with new ids into the target section", async () => {
    const assignments: Record<string, string> = { a: "personal" };
    const { options, assign } = createOptions(assignments);
    const container = await openLibrary(options, [makeItem("a")]);
    await selectItem(container, 0);
    openDropdown(container);
    fireEvent.click(queryByTestId(container, "lib-dropdown--copy-vault")!);

    await waitFor(async () => {
      const latest = await h.app.library.getLatestLibrary();
      expect(latest.length).toBe(2);
    });
    const latest = await h.app.library.getLatestLibrary();
    const copy = latest.find((item) => item.id !== "a")!;
    expect(assign).toHaveBeenCalledWith([copy.id], "vault");
    expect(assignments[copy.id]).toBe("vault");
    expect(assignments.a).toBe("personal");
    expect(copy.elements.length).toBe(1);
  });

  it("imports only unique items into a section", async () => {
    const assignments: Record<string, string> = { a: "personal" };
    const existing = makeItem("a");
    const fresh: LibraryItem = {
      ...makeItem("new"),
      elements: [
        API.createElement({ type: "ellipse", id: "el-new", width: 77 }),
      ],
    };
    let blob = new Blob([], {
      type: MIME_TYPES.excalidrawlib,
    });
    const { options, assign } = createOptions(assignments, {
      pickLibraryFile: vi.fn(async () => blob),
    });
    const container = await openLibrary(options, [existing]);
    // the file must hold the item as stored (restored) in the library
    const stored = await h.app.library.getLatestLibrary();
    blob = new Blob([serializeLibraryAsJSON([...stored, fresh])], {
      type: MIME_TYPES.excalidrawlib,
    });
    openDropdown(container);
    fireEvent.click(queryByTestId(container, "lib-dropdown--import-vault")!);

    await waitFor(() => expect(assign).toHaveBeenCalledTimes(1));
    expect(assign.mock.calls[0][0]).toEqual(["new"]);
    expect(assign.mock.calls[0][1]).toBe("vault");
    await waitFor(async () => {
      expect((await h.app.library.getLatestLibrary()).length).toBe(2);
    });
  });

  it("clears only the items of a section", async () => {
    const assignments: Record<string, string> = {
      a: "personal",
      b: "vault",
      c: "vault",
    };
    const { options } = createOptions(assignments);
    const container = await openLibrary(options, [
      makeItem("a"),
      makeItem("b"),
      makeItem("c"),
    ]);
    openDropdown(container);
    fireEvent.click(queryByTestId(container, "lib-dropdown--clear-vault")!);
    const confirm = await waitFor(() => {
      const el = Array.from(
        document.querySelectorAll(".confirm-dialog-buttons button"),
      ).pop();
      expect(el).not.toBeNull();
      return el!;
    });
    fireEvent.click(confirm);
    await waitFor(async () => {
      const latest = await h.app.library.getLatestLibrary();
      expect(latest.map((i) => i.id)).toEqual(["a"]);
    });
  });

  it("exports a section through the host hook", async () => {
    const assignments: Record<string, string> = { a: "personal", b: "vault" };
    const saveLibraryFile = vi.fn(async () => {});
    const { options } = createOptions(assignments, { saveLibraryFile });
    const container = await openLibrary(options, [
      makeItem("a"),
      makeItem("b"),
    ]);
    openDropdown(container);
    fireEvent.click(queryByTestId(container, "lib-dropdown--export-vault")!);
    await waitFor(() => expect(saveLibraryFile).toHaveBeenCalledTimes(1));
    const [items, name] = saveLibraryFile.mock.calls[0] as any[];
    expect(items.map((i: LibraryItem) => i.id)).toEqual(["b"]);
    expect(name).toBe("This vault");
  });

  it("online:false hides Browse libraries and Publish", async () => {
    const { options } = createOptions({ a: "personal" });
    const container = await openLibrary(options, [makeItem("a")]);
    expect(container.querySelector(".library-menu-browse-button")).toBeNull();
    await selectItem(container, 0);
    openDropdown(container);
    expect(queryByTestId(container, "lib-dropdown--remove")).toBeNull();
  });

  it("without libraryUIOptions the default menu is unchanged", async () => {
    const container = await openLibrary(undefined, [makeItem("a")]);
    expect(
      container.querySelector(".library-menu-browse-button"),
    ).not.toBeNull();
    expect(container.querySelector('[data-testid^="library-section-"]')).toBe(
      null,
    );
    await selectItem(container, 0);
    openDropdown(container);
    expect(queryByTestId(container, "lib-dropdown--remove")).not.toBeNull();
    expect(unitIds(container).length).toBeGreaterThan(0);
  });
});
