import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createWorkspaceStore,
  deserialize,
  MAX_SESSION_TABS,
  serialize,
  sessionKey,
} from "./workspaceStore";

import type { Tab, TabsState } from "./types";

function memStorage() {
  const m = new Map<string, string>();
  const calls = { set: 0 };
  return {
    m,
    calls,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => {
      calls.set++;
      m.set(k, v);
    },
    removeItem: (k: string) => void m.delete(k),
  };
}

const tab = (n: number, over: Partial<Tab> = {}): Tab => ({
  id: `t${n}`,
  path: `d${n}.excalidraw`,
  pinned: false,
  missing: false,
  ...over,
});

const stateOf = (tabs: Tab[], activeId = tabs[0].id): TabsState => ({
  tabs,
  activeId,
  mru: [activeId, ...tabs.map((t) => t.id).filter((i) => i !== activeId)],
  closed: [],
  nextId: tabs.length + 1,
});

const all = () => true;

describe("serialize / deserialize", () => {
  it("round trips and drops ids, missing flag and closed stack", () => {
    const tabs = [
      tab(1, { pinned: true }),
      tab(2, { view: { scrollX: 5, scrollY: -3, zoom: 1.5 } }),
      tab(3, { path: null }),
    ];
    const st = { ...stateOf(tabs, "t2"), mru: ["t2", "t3", "t1"] };
    const s = serialize(st);
    expect(JSON.stringify(s)).not.toContain('t2"');
    expect(s.active).toBe(1);
    expect(s.mru).toEqual([1, 2, 0]);
    const r = deserialize(JSON.parse(JSON.stringify(s)), all)!;
    expect(r.tabs).toEqual([
      { path: "d1.excalidraw", pinned: true },
      {
        path: "d2.excalidraw",
        pinned: false,
        view: { scrollX: 5, scrollY: -3, zoom: 1.5 },
      },
      { path: null, pinned: false },
    ]);
    expect(r.activeIndex).toBe(1);
    expect(r.mru).toEqual([1, 2, 0]);
  });

  it.each([
    ["null", null],
    ["string", "x"],
    ["array", []],
    ["wrong version", { v: 2, tabs: [], active: 0, mru: [] }],
    ["non-array tabs", { v: 1, tabs: {}, active: 0, mru: [] }],
    ["empty tabs", { v: 1, tabs: [], active: 0, mru: [] }],
    [
      "bad active",
      { v: 1, tabs: [{ path: "a", pinned: false }], active: "0", mru: [] },
    ],
    [
      "bad mru",
      { v: 1, tabs: [{ path: "a", pinned: false }], active: 0, mru: 3 },
    ],
    ["bad tab", { v: 1, tabs: [5], active: 0, mru: [] }],
    [
      "bad pinned",
      { v: 1, tabs: [{ path: "a", pinned: 1 }], active: 0, mru: [] },
    ],
    [
      "bad path",
      { v: 1, tabs: [{ path: 3, pinned: false }], active: 0, mru: [] },
    ],
  ])("rejects garbage: %s", (_n, raw) => {
    expect(deserialize(raw, all)).toBeNull();
  });

  it.each([
    ["NaN zoom", NaN],
    ["negative zoom", -1],
    ["zero zoom", 0],
    ["huge zoom", 1e9],
    ["Infinity zoom", Infinity],
    ["string zoom", "2"],
  ])("rejects bad view: %s", (_n, zoom) => {
    const raw = {
      v: 1,
      tabs: [
        { path: "a", pinned: false, view: { scrollX: 0, scrollY: 0, zoom } },
      ],
      active: 0,
      mru: [0],
    };
    expect(deserialize(raw, all)).toBeNull();
  });

  it("rejects non-finite scroll", () => {
    const raw = {
      v: 1,
      tabs: [
        {
          path: "a",
          pinned: false,
          view: { scrollX: Infinity, scrollY: 0, zoom: 1 },
        },
      ],
      active: 0,
      mru: [0],
    };
    expect(deserialize(raw, all)).toBeNull();
  });

  it("caps the number of tabs", () => {
    const tabs = Array.from({ length: MAX_SESSION_TABS + 1 }, (_, i) => ({
      path: `p${i}`,
      pinned: false,
    }));
    expect(deserialize({ v: 1, tabs, active: 0, mru: [] }, all)).toBeNull();
    expect(
      deserialize({ v: 1, tabs: tabs.slice(1), active: 0, mru: [] }, all),
    ).not.toBeNull();
  });

  it("drops missing paths and fixes up indexes", () => {
    const raw = {
      v: 1,
      tabs: [
        { path: "a", pinned: false },
        { path: "gone", pinned: false },
        { path: "c", pinned: false },
        { path: "d", pinned: false },
      ],
      active: 1, // dropped
      mru: [1, 3, 0, 2],
    };
    const r = deserialize(raw, (p) => p !== "gone")!;
    expect(r.tabs.map((t) => t.path)).toEqual(["a", "c", "d"]);
    expect(r.activeIndex).toBe(2); // MRU-first survivor is "d"
    expect(r.mru).toEqual([2, 0, 1]);
  });

  it("keeps home tabs (null path) and completes a short mru", () => {
    const raw = {
      v: 1,
      tabs: [
        { path: null, pinned: false },
        { path: "a", pinned: false },
      ],
      active: 0,
      mru: [1],
    };
    const r = deserialize(raw, all)!;
    expect(r.tabs).toHaveLength(2);
    expect([...r.mru].sort()).toEqual([0, 1]);
    expect(r.mru[0]).toBe(r.activeIndex);
  });

  it("drops duplicate paths", () => {
    const raw = {
      v: 1,
      tabs: [
        { path: "a", pinned: false },
        { path: "a", pinned: true },
        { path: "b", pinned: false },
      ],
      active: 2,
      mru: [2, 1, 0],
    };
    const r = deserialize(raw, all)!;
    expect(r.tabs.map((t) => t.path)).toEqual(["a", "b"]);
    expect(r.activeIndex).toBe(1);
    expect(r.mru).toEqual([1, 0]);
  });

  it("enforces pinned-first ordering and remaps indexes", () => {
    const raw = {
      v: 1,
      tabs: [
        { path: "a", pinned: false },
        { path: "b", pinned: true },
        { path: "c", pinned: false },
      ],
      active: 0,
      mru: [0, 2, 1],
    };
    const r = deserialize(raw, all)!;
    expect(r.tabs.map((t) => t.path)).toEqual(["b", "a", "c"]);
    expect(r.activeIndex).toBe(1);
    expect(r.mru).toEqual([1, 2, 0]);
  });

  it("returns null when no tab survives", () => {
    const raw = {
      v: 1,
      tabs: [{ path: "a", pinned: false }],
      active: 0,
      mru: [0],
    };
    expect(deserialize(raw, () => false)).toBeNull();
  });

  it("a 20-tab session serializes under 10 KB", () => {
    const tabs = Array.from({ length: 20 }, (_, i) =>
      tab(i + 1, {
        path: `Projects/Some Folder/A reasonably long drawing name ${i}.excalidraw`,
        view: { scrollX: -1234.5678901, scrollY: 987.654321, zoom: 1.2345678 },
      }),
    );
    const json = JSON.stringify(serialize(stateOf(tabs)));
    expect(json.length).toBeLessThan(10 * 1024);
  });

  it("benchmark: 20 tabs", () => {
    const tabs = Array.from({ length: 20 }, (_, i) =>
      tab(i + 1, { view: { scrollX: i, scrollY: -i, zoom: 1 } }),
    );
    const st = stateOf(tabs);
    const N = 200;
    let json = "";
    const t0 = performance.now();
    for (let i = 0; i < N; i++) {
      json = JSON.stringify(serialize(st));
    }
    const t1 = performance.now();
    for (let i = 0; i < N; i++) {
      deserialize(JSON.parse(json), all);
    }
    const t2 = performance.now();
    // eslint-disable-next-line no-console
    console.log(
      `serialize+stringify ${((t1 - t0) / N).toFixed(
        4,
      )} ms, parse+deserialize ${((t2 - t1) / N).toFixed(
        4,
      )} ms (20 tabs, avg of ${N})`,
    );
    expect((t1 - t0) / N).toBeLessThan(5);
  });
});

describe("createWorkspaceStore", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const st = (n = 2) =>
    stateOf(Array.from({ length: n }, (_, i) => tab(i + 1)));

  it("coalesces 10 schedules into one write after the debounce", () => {
    const s = memStorage();
    const ws = createWorkspaceStore({ storage: s });
    for (let i = 0; i < 10; i++) {
      ws.scheduleSave("/v", st(1 + (i % 2)));
    }
    expect(s.calls.set).toBe(0);
    vi.advanceTimersByTime(999);
    expect(s.calls.set).toBe(0);
    vi.advanceTimersByTime(1);
    expect(s.calls.set).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("writes the latest state", () => {
    const s = memStorage();
    const ws = createWorkspaceStore({ storage: s });
    ws.scheduleSave("/v", st(1));
    ws.scheduleSave("/v", st(3));
    vi.advanceTimersByTime(1000);
    expect(JSON.parse(s.m.get(sessionKey("/v"))!).tabs).toHaveLength(3);
  });

  it("flush writes immediately and cancels the timer", () => {
    const s = memStorage();
    const ws = createWorkspaceStore({ storage: s });
    ws.scheduleSave("/v", st());
    ws.flush();
    expect(s.calls.set).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
    ws.flush(); // nothing pending
    expect(s.calls.set).toBe(1);
  });

  it("does not rewrite unchanged JSON", () => {
    const s = memStorage();
    const ws = createWorkspaceStore({ storage: s });
    ws.scheduleSave("/v", st());
    ws.flush();
    ws.scheduleSave("/v", st());
    ws.flush();
    expect(s.calls.set).toBe(1);
    ws.scheduleSave("/v", st(3));
    ws.flush();
    expect(s.calls.set).toBe(2);
  });

  it("scheduling for another vault flushes the previous one first", () => {
    const s = memStorage();
    const ws = createWorkspaceStore({ storage: s });
    ws.scheduleSave("/a", st());
    ws.scheduleSave("/b", st());
    expect(s.m.has(sessionKey("/a"))).toBe(true);
    ws.flush();
    expect(s.m.has(sessionKey("/b"))).toBe(true);
  });

  it("load round trips and validates against the tree", () => {
    const s = memStorage();
    const ws = createWorkspaceStore({ storage: s });
    ws.scheduleSave("/v", st(3));
    ws.flush();
    const r = createWorkspaceStore({ storage: s }).load(
      "/v",
      (p) => p !== "d2.excalidraw",
    )!;
    expect(r.tabs.map((t) => t.path)).toEqual([
      "d1.excalidraw",
      "d3.excalidraw",
    ]);
    expect(createWorkspaceStore({ storage: s }).load("/other", all)).toBeNull();
  });

  it("load returns null for corrupt JSON", () => {
    const s = memStorage();
    s.m.set(sessionKey("/v"), "{not json");
    expect(createWorkspaceStore({ storage: s }).load("/v", all)).toBeNull();
  });

  it("clear removes the saved session and a pending save", () => {
    const s = memStorage();
    const ws = createWorkspaceStore({ storage: s });
    ws.scheduleSave("/v", st());
    ws.flush();
    ws.scheduleSave("/v", st(3));
    ws.clear("/v");
    vi.advanceTimersByTime(5000);
    expect(s.m.has(sessionKey("/v"))).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("dispose drops pending work without writing", () => {
    const s = memStorage();
    const ws = createWorkspaceStore({ storage: s });
    ws.scheduleSave("/v", st());
    ws.dispose();
    vi.advanceTimersByTime(5000);
    expect(s.calls.set).toBe(0);
  });

  it("storage that throws never throws", () => {
    const bad = {
      getItem: () => {
        throw new Error("no");
      },
      setItem: () => {
        throw new Error("no");
      },
      removeItem: () => {
        throw new Error("no");
      },
    };
    const ws = createWorkspaceStore({ storage: bad });
    expect(() => {
      ws.scheduleSave("/v", st());
      ws.flush();
      ws.clear("/v");
    }).not.toThrow();
    expect(ws.load("/v", all)).toBeNull();
  });

  it("injectable timers are used", () => {
    const set = vi.fn(() => 7);
    const clear = vi.fn();
    const ws = createWorkspaceStore({
      storage: memStorage(),
      setTimeout: set,
      clearTimeout: clear,
      debounceMs: 250,
    });
    ws.scheduleSave("/v", st());
    expect(set).toHaveBeenCalledWith(expect.any(Function), 250);
    ws.dispose();
    expect(clear).toHaveBeenCalledWith(7);
  });
});
