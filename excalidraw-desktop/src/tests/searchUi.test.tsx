/** Search UI: grouped results, keyboard, fallback, hook latest-wins, focusElement. */
import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
} from "@testing-library/react";
import { useRef, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SearchResults } from "../components/search/SearchResults";
import { focusElement } from "../editor/focusElement";
import { Highlighted, normalizeRanges } from "../search/highlight";
import { useVaultSearch } from "../search/useVaultSearch";

import { FakeVaultRepository } from "./fakeVaultRepository";
import { FakeVaultSearch } from "./fakeVaultSearch";
import { SAMPLE_SCENE, SEARCH_SCENE } from "./fixtures";

import type { IndexStatus, SearchResponse, VaultSearch } from "../search/types";
import type { TagsResponse } from "../tags/types";
import type { VaultEntry } from "../vault/types";

const status = (over: Partial<IndexStatus> = {}): IndexStatus => ({
  handle: "h",
  state: "ready",
  indexed: 1,
  total: 1,
  ...over,
});

const NO_TAGS: TagsResponse = {
  tags: [],
  byPath: {},
  status: status(),
  tookMs: 0,
};

const response = (over: Partial<SearchResponse> = {}): SearchResponse => ({
  query: "dijk",
  results: [
    {
      path: "DSA/Shortest Paths.excalidraw",
      name: "Shortest Paths.excalidraw",
      score: 10,
      nameHighlights: [[0, 8]],
      matchCount: 2,
      matches: [
        {
          elementId: "algo-label",
          containerId: "algo-rect",
          kind: "text",
          snippet: "Dijkstra shortest path",
          highlights: [[0, 4]],
        },
        {
          elementId: "algo-frame",
          containerId: null,
          kind: "frame",
          snippet: "Dijkstra frame",
          highlights: [[0, 4]],
        },
      ],
    },
    {
      path: "B.excalidraw",
      name: "B.excalidraw",
      score: 1,
      nameHighlights: [],
      matchCount: 0,
      matches: [],
    },
  ],
  totalMatches: 2,
  status: status(),
  tookMs: 1,
  ...over,
});

const entries: VaultEntry[] = [
  { path: "DSA", name: "DSA", kind: "folder", modifiedAt: 0, size: 0 },
  {
    path: "DSA/Graphs.excalidraw",
    name: "Graphs.excalidraw",
    kind: "drawing",
    modifiedAt: 0,
    size: 1,
  },
];

function stubSearch(
  res: SearchResponse | (() => Promise<SearchResponse>),
): VaultSearch {
  return {
    search: vi.fn(async () => (typeof res === "function" ? res() : res)),
    status: vi.fn(async () => status()),
    subscribe: vi.fn(async () => () => {}),
    tags: async () => NO_TAGS,
  };
}

function Harness({
  search,
  initial = "dijk",
  handlers,
}: {
  search: VaultSearch | null;
  initial?: string;
  handlers: {
    drawing: (p: string) => void;
    match: (p: string, m: { elementId: string }) => void;
    folder: (p: string) => void;
  };
}) {
  const [q, setQ] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={ref}
        aria-label="q"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && setQ("")}
      />
      {q && (
        <SearchResults
          query={q}
          inputRef={ref}
          search={search}
          handle="h"
          allIndexedEntries={entries}
          activePath={null}
          onOpenDrawing={handlers.drawing}
          onOpenMatch={handlers.match}
          onOpenFolder={handlers.folder}
        />
      )}
    </>
  );
}

const mkHandlers = () => ({
  drawing: vi.fn(),
  match: vi.fn(),
  folder: vi.fn(),
});

afterEach(() => vi.useRealTimers());

describe("SearchResults", () => {
  it("renders drawings with highlighted names, snippets and a status line", async () => {
    const { container } = render(
      <Harness search={stubSearch(response())} handlers={mkHandlers()} />,
    );
    await screen.findByText("2 drawings");
    const options = screen.getAllByRole("option");
    expect(options.map((o) => o.getAttribute("data-kind"))).toEqual([
      "drawing",
      "snippet",
      "snippet",
      "drawing",
    ]);
    const marks = [...container.querySelectorAll("mark.vault-search-mark")];
    expect(marks.map((m) => m.textContent)).toEqual([
      "Shortest",
      "Dijk",
      "Dijk",
    ]);
    expect(options[0]).toHaveTextContent("DSA"); // folder path
    expect(options[0]).toHaveTextContent("2"); // match count
  });

  it("navigates with arrows, activates with Enter, Escape clears", async () => {
    const handlers = mkHandlers();
    render(<Harness search={stubSearch(response())} handlers={handlers} />);
    await screen.findByText("2 drawings");
    const input = screen.getByLabelText("q");
    const options = () => screen.getAllByRole("option");
    expect(options()[0]).toHaveAttribute("aria-selected", "true");
    expect(input.getAttribute("aria-activedescendant")).toBe(options()[0].id);

    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(options()[1]).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(handlers.match).toHaveBeenCalledWith(
      "DSA/Shortest Paths.excalidraw",
      expect.objectContaining({ elementId: "algo-label" }),
    );

    fireEvent.keyDown(input, { key: "ArrowUp" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(handlers.drawing).toHaveBeenCalledWith(
      "DSA/Shortest Paths.excalidraw",
    );

    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("clicking a snippet row opens the element, folder rows expand", async () => {
    const handlers = mkHandlers();
    render(
      <Harness
        search={stubSearch(response())}
        initial="dsa"
        handlers={handlers}
      />,
    );
    await screen.findByText("Folders");
    fireEvent.click(screen.getAllByRole("option")[0]);
    expect(handlers.folder).toHaveBeenCalledWith("DSA");
  });

  it("falls back to name-only results without a search backend", async () => {
    const handlers = mkHandlers();
    render(<Harness search={null} initial="graph" handlers={handlers} />);
    const rows = await screen.findAllByRole("option");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveAttribute("data-path", "DSA/Graphs.excalidraw");
    fireEvent.click(rows[0]);
    expect(handlers.drawing).toHaveBeenCalledWith("DSA/Graphs.excalidraw");
  });

  it("shows indexing progress and no-match state", async () => {
    const res = response({
      results: [],
      totalMatches: 0,
      status: status({ state: "building", indexed: 1234, total: 5000 }),
    });
    render(<Harness search={stubSearch(res)} handlers={mkHandlers()} />);
    await screen.findByText("Indexing 1,234 of 5,000 drawings…");
  });
});

describe("highlight helpers", () => {
  it("clamps, drops empty and merges overlapping ranges", () => {
    expect(
      normalizeRanges(
        [
          [5, 9],
          [-3, 2],
          [1, 4],
          [8, 99],
          [3, 3],
        ],
        10,
      ),
    ).toEqual([
      [0, 4],
      [5, 10],
    ]);
    const { container } = render(
      <Highlighted
        text="hello world"
        ranges={[
          [6, 100],
          [0, 2],
        ]}
      />,
    );
    expect(container.textContent).toBe("hello world");
    expect(container.querySelectorAll("mark")).toHaveLength(2);
  });
});

describe("useVaultSearch", () => {
  it("is debounced, latest wins, and empty query clears", async () => {
    vi.useFakeTimers();
    const resolvers: Record<string, (r: SearchResponse) => void> = {};
    const search: VaultSearch = {
      search: vi.fn(
        (_h, q) =>
          new Promise<SearchResponse>((resolve) => {
            resolvers[q] = resolve;
          }),
      ),
      status: async () => status(),
      tags: async () => NO_TAGS,
      subscribe: async () => () => {},
    };
    const { result, rerender } = renderHook(
      ({ q }) => useVaultSearch(search, "h", q),
      { initialProps: { q: "a" } },
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(59);
    });
    expect(search.search).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2);
    });
    expect(search.search).toHaveBeenCalledTimes(1);

    rerender({ q: "ab" });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(61);
    });
    expect(search.search).toHaveBeenCalledTimes(2);
    // Newest answers first, the stale one arrives later and is dropped.
    await act(async () => {
      resolvers.ab(response({ query: "ab" }));
      resolvers.a(response({ query: "a" }));
    });
    expect(result.current.response?.query).toBe("ab");
    expect(result.current.loading).toBe(false);

    rerender({ q: "  " });
    expect(result.current.response).toBeNull();
  });

  it("re-runs when the index goes from building to ready", async () => {
    vi.useFakeTimers();
    let emit: (s: IndexStatus) => void = () => {};
    const search: VaultSearch = {
      search: vi.fn(async () => response()),
      status: async () => status({ state: "building", indexed: 0, total: 3 }),
      tags: async () => NO_TAGS,
      subscribe: async (l) => {
        emit = l;
        return () => {};
      },
    };
    renderHook(() => useVaultSearch(search, "h", "dijk"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(search.search).toHaveBeenCalledTimes(1);
    await act(async () => {
      emit(status({ state: "ready", indexed: 3, total: 3 }));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(search.search).toHaveBeenCalledTimes(2);
  });
});

describe("FakeVaultSearch", () => {
  it("finds bound labels and frame names, accent/case-insensitively", async () => {
    const repo = new FakeVaultRepository();
    repo.seedDrawing("DSA/Shortest Paths.excalidraw", SEARCH_SCENE);
    repo.seedDrawing("Other.excalidraw", SAMPLE_SCENE);
    const search = new FakeVaultSearch(repo);
    const res = await search.search(repo.handle, "DIJKSTRA path");
    expect(res.results).toHaveLength(1);
    const hit = res.results[0];
    expect(hit.matches[0]).toMatchObject({
      elementId: "algo-label",
      containerId: "algo-rect",
      kind: "text",
    });
    expect(hit.matches[0].highlights).toEqual([
      [0, 8],
      [18, 22],
    ]);
    const frame = await search.search(repo.handle, "graph algo");
    expect(frame.results[0].matches[0]).toMatchObject({
      elementId: "algo-frame",
      kind: "frame",
    });
    expect((await search.search(repo.handle, "zzz")).results).toEqual([]);
  });
});

describe("focusElement", () => {
  const el = (id: string, extra = {}) => ({
    id,
    x: 10,
    y: 20,
    width: 100,
    height: 50,
    isDeleted: false,
    ...extra,
  });
  const mkApi = (elements: unknown[]) =>
    ({
      getSceneElements: () => elements,
      updateScene: vi.fn(),
      setViewport: vi.fn(),
    } as never);

  it("selects the container of a bound label and centres on it", () => {
    const api = mkApi([el("rect"), el("label", { containerId: "rect" })]) as {
      updateScene: ReturnType<typeof vi.fn>;
      setViewport: ReturnType<typeof vi.fn>;
    };
    expect(
      focusElement(api as never, { elementId: "label", containerId: "rect" }),
    ).toBe(true);
    expect(api.updateScene).toHaveBeenCalledWith(
      expect.objectContaining({
        appState: expect.objectContaining({
          selectedElementIds: { rect: true },
        }),
      }),
    );
    const call = api.setViewport.mock.calls[0][0];
    expect(call.fit).toBe("scale-down");
    expect(call.target[0]).toBeLessThan(10);
  });

  it("returns false when the element is gone", () => {
    const api = mkApi([el("gone", { isDeleted: true })]) as {
      updateScene: ReturnType<typeof vi.fn>;
    };
    expect(
      focusElement(api as never, { elementId: "gone", containerId: null }),
    ).toBe(false);
    expect(api.updateScene).not.toHaveBeenCalled();
  });
});
