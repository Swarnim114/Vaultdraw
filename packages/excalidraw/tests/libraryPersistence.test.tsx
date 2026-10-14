import React from "react";
import { vi } from "vitest";

import { useHandleLibrary } from "../data/library";
import { Excalidraw } from "../index";

import { API } from "./helpers/api";
import { render, waitFor } from "./test-utils";

import type {
  LibraryPersistedData,
  LibraryPersistenceAdapter,
} from "../data/library";
import type { ExcalidrawImperativeAPI, LibraryItem } from "../types";

const makeItem = (id: string): LibraryItem => ({
  id,
  status: "unpublished",
  created: 1,
  elements: [API.createElement({ type: "rectangle", id: `${id}-el` })],
});

const Host = (props: {
  adapter: LibraryPersistenceAdapter;
  onLibraryChange?: (items: readonly LibraryItem[]) => void;
  onApi?: (api: ExcalidrawImperativeAPI) => void;
}) => {
  const [api, setApi] = React.useState<ExcalidrawImperativeAPI | null>(null);
  useHandleLibrary({ excalidrawAPI: api, adapter: props.adapter });
  return (
    <Excalidraw
      onLibraryChange={props.onLibraryChange}
      onExcalidrawAPI={(a) => {
        setApi(a);
        if (a) {
          props.onApi?.(a);
        }
      }}
    />
  );
};

const latest = () => window.h.app.library.getLatestLibrary();

describe("library persistence", () => {
  it("adopts restored adapter items without copying and detects changes", async () => {
    const stored = [makeItem("a"), makeItem("b")];
    const saves: LibraryPersistedData[] = [];
    const adapter: LibraryPersistenceAdapter = {
      load: () => {
        return { libraryItems: stored, restored: true };
      },
      save: (data) => {
        saves.push(data);
      },
    };
    let api!: ExcalidrawImperativeAPI;
    await render(<Host adapter={adapter} onApi={(a) => (api = a)} />);
    await waitFor(async () => {
      expect(await latest()).toHaveLength(2);
    });
    // loading what is stored is not a change
    expect(saves).toHaveLength(0);

    // adding an item is saved with the stored ones kept
    await api.updateLibrary({
      libraryItems: [makeItem("c")],
      merge: true,
    });
    await waitFor(() => expect(saves).toHaveLength(1));
    expect(saves[0].libraryItems.map((i) => i.id)).toEqual(["c", "a", "b"]);

    // deleting is detected as well
    await api.updateLibrary({
      libraryItems: [makeItem("a"), makeItem("c")],
      merge: false,
    });
    await waitFor(() => expect(saves).toHaveLength(2));
    expect(saves[1].libraryItems.map((i) => i.id).sort()).toEqual(["a", "c"]);
  });

  it("restores items the adapter did not flag as restored", async () => {
    const legacy = [[API.createElement({ type: "rectangle" })]];
    const adapter: LibraryPersistenceAdapter = {
      load: () => ({ libraryItems: legacy as any }),
      save: () => {},
    };
    await render(<Host adapter={adapter} />);
    await waitFor(async () => {
      const items = await latest();
      expect(items).toHaveLength(1);
      expect(items![0].status).toBe("published");
      expect(typeof items![0].id).toBe("string");
    });
  });

  it("hands onLibraryChange a defensive copy", async () => {
    const onChange = vi.fn();
    const stored = [makeItem("a")];
    const adapter: LibraryPersistenceAdapter = {
      load: () => {
        return { libraryItems: stored, restored: true };
      },
      save: () => {},
    };
    await render(<Host adapter={adapter} onLibraryChange={onChange} />);
    await waitFor(() =>
      expect(onChange.mock.calls.at(-1)?.[0]).toHaveLength(1),
    );
    const given = onChange.mock.calls.at(-1)![0] as LibraryItem[];
    expect(given).toHaveLength(1);
    expect(given[0]).not.toBe(stored[0]);
    expect(given[0].elements[0]).not.toBe(stored[0].elements[0]);
    // mutating the copy leaves the editor library untouched
    given[0].elements = [];
    const after = await latest();
    expect(after[0].elements).toHaveLength(1);
  });
});
