import { describe, expect, it } from "vitest";

import {
  activate,
  assertInvariants,
  canCloseWithShortcut,
  close,
  closeAll,
  closeOthers,
  closeRight,
  findByPath,
  fromSession,
  getActiveTab,
  goTo,
  goToLast,
  initialState,
  mruNext,
  mruPrev,
  move,
  moveBy,
  newTab,
  next,
  openPath,
  prev,
  removePath,
  renamePath,
  reopenClosed,
  setMissing,
  setView,
  targetForCreated,
  togglePin,
} from "./tabsModel";
import { CLOSED_STACK_CAP } from "./types";

import type { OpenOptions, TabsState } from "./types";

const NEW: OpenOptions = { target: "new" };
const CUR: OpenOptions = { target: "current" };

/** Home tab replaced by the first path, then each further path in a new tab. */
const build = (...paths: string[]): TabsState => {
  let s = initialState();
  paths.forEach((p, i) => {
    s = openPath(s, p, i === 0 ? CUR : { target: "new", position: "end" });
  });
  assertInvariants(s);
  return s;
};

const paths = (s: TabsState) => s.tabs.map((t) => t.path);
const idOf = (s: TabsState, path: string) => findByPath(s, path)!.id;
const active = (s: TabsState) => getActiveTab(s).path;

describe("initialState / queries", () => {
  it("has one active home tab", () => {
    const s = initialState();
    expect(paths(s)).toEqual([null]);
    expect(s.mru).toEqual([s.activeId]);
    assertInvariants(s);
  });

  it("targetForCreated: current on home tab, new otherwise", () => {
    expect(targetForCreated(initialState())).toBe("current");
    expect(targetForCreated(build("a"))).toBe("new");
  });
});

describe("openPath", () => {
  it("current replaces the active tab and clears view and missing", () => {
    let s = build("a");
    s = setView(s, s.activeId, { scrollX: 1, scrollY: 2, zoom: 3 });
    s = setMissing(s, "a", true);
    const id = s.activeId;
    s = openPath(s, "b", CUR);
    expect(paths(s)).toEqual(["b"]);
    expect(s.activeId).toBe(id);
    expect(getActiveTab(s).view).toBeUndefined();
    expect(getActiveTab(s).missing).toBe(false);
    assertInvariants(s);
  });

  it("current on a pinned active tab opens a new tab right after it", () => {
    let s = build("a", "b");
    s = togglePin(s, idOf(s, "a"));
    s = activate(s, idOf(s, "a"));
    s = openPath(s, "c", CUR);
    expect(paths(s)).toEqual(["a", "c", "b"]);
    expect(active(s)).toBe("c");
    assertInvariants(s);
  });

  it("an already open path just activates its tab", () => {
    const s = build("a", "b", "c");
    const s2 = openPath(s, "a", NEW);
    expect(paths(s2)).toEqual(paths(s));
    expect(active(s2)).toBe("a");
    expect(s2.nextId).toBe(s.nextId);
    expect(openPath(s2, "a", CUR)).toBe(s2);
    assertInvariants(s2);
  });

  it("new inserts after the active tab by default, or at the end", () => {
    let s = build("a", "b", "c");
    s = activate(s, idOf(s, "a"));
    expect(paths(openPath(s, "d", NEW))).toEqual(["a", "d", "b", "c"]);
    expect(paths(openPath(s, "d", { target: "new", position: "end" }))).toEqual(
      ["a", "b", "c", "d"],
    );
  });

  it("new never goes before pinned tabs", () => {
    let s = build("a", "b", "c");
    s = togglePin(s, idOf(s, "a"));
    s = togglePin(s, idOf(s, "b"));
    s = activate(s, idOf(s, "c"));
    s = openPath(s, "d", NEW);
    expect(paths(s)).toEqual(["a", "b", "c", "d"]);
    assertInvariants(s);
  });

  it("focus:false keeps the active tab and puts the new one second in MRU", () => {
    let s = build("a", "b", "c");
    s = activate(s, idOf(s, "a"));
    const before = s.activeId;
    s = openPath(s, "d", { target: "new", focus: false });
    expect(s.activeId).toBe(before);
    expect(s.mru[0]).toBe(before);
    expect(s.mru[1]).toBe(idOf(s, "d"));
    assertInvariants(s);
  });

  it("focus:true (default) activates the new tab", () => {
    const s = openPath(build("a"), "b", NEW);
    expect(active(s)).toBe("b");
    expect(s.mru[1]).toBe(idOf(s, "a"));
  });
});

describe("newTab", () => {
  it("adds an activated home tab after the active tab", () => {
    let s = build("a", "b");
    s = activate(s, idOf(s, "a"));
    s = newTab(s);
    expect(paths(s)).toEqual(["a", null, "b"]);
    expect(getActiveTab(s).path).toBeNull();
    assertInvariants(s);
  });

  it("position end", () => {
    let s = build("a", "b");
    s = activate(s, idOf(s, "a"));
    expect(paths(newTab(s, "end"))).toEqual(["a", "b", null]);
  });
});

describe("activate", () => {
  it("updates MRU; no-op for active or unknown id", () => {
    const s = build("a", "b", "c");
    expect(activate(s, s.activeId)).toBe(s);
    expect(activate(s, "nope")).toBe(s);
    const s2 = activate(s, idOf(s, "a"));
    expect(s2.mru[0]).toBe(idOf(s, "a"));
    assertInvariants(s2);
  });
});

describe("close", () => {
  it("closing the active tab activates the MRU previous tab", () => {
    let s = build("a", "b", "c");
    s = activate(s, idOf(s, "a")); // mru: a c b
    s = activate(s, idOf(s, "b")); // mru: b a c
    s = close(s, idOf(s, "b"));
    expect(active(s)).toBe("a");
    assertInvariants(s);
  });

  it("closing a background tab keeps the active tab", () => {
    let s = build("a", "b", "c");
    s = close(s, idOf(s, "a"));
    expect(active(s)).toBe("c");
    expect(paths(s)).toEqual(["b", "c"]);
  });

  it("closing the last tab leaves a fresh home tab", () => {
    let s = build("a");
    const oldId = s.activeId;
    s = close(s, oldId);
    expect(paths(s)).toEqual([null]);
    expect(s.activeId).not.toBe(oldId);
    expect(s.closed.map((c) => c.tab.path)).toEqual(["a"]);
    assertInvariants(s);
  });

  it("home tabs are not pushed on the closed stack; unknown id is a no-op", () => {
    let s = newTab(build("a"));
    const home = s.activeId;
    s = close(s, home);
    expect(s.closed).toEqual([]);
    expect(close(s, "nope")).toBe(s);
  });

  it("caps the closed stack at CLOSED_STACK_CAP, dropping the oldest", () => {
    let s = initialState();
    for (let i = 0; i < CLOSED_STACK_CAP + 5; i++) {
      s = openPath(s, `f${i}`, CUR);
      s = close(s, s.activeId);
    }
    expect(s.closed).toHaveLength(CLOSED_STACK_CAP);
    expect(s.closed[0].tab.path).toBe("f5");
    expect(s.closed[CLOSED_STACK_CAP - 1].tab.path).toBe(
      `f${CLOSED_STACK_CAP + 4}`,
    );
    assertInvariants(s);
  });

  it("close always closes a pinned tab; canCloseWithShortcut says otherwise", () => {
    let s = build("a", "b");
    const a = idOf(s, "a");
    s = togglePin(s, a);
    expect(canCloseWithShortcut(s, a, false)).toBe(false);
    expect(canCloseWithShortcut(s, a, true)).toBe(true);
    expect(canCloseWithShortcut(s, idOf(s, "b"), false)).toBe(true);
    expect(canCloseWithShortcut(s, "nope", true)).toBe(false);
    expect(paths(close(s, a))).toEqual(["b"]);
  });
});

describe("closeOthers / closeRight / closeAll (pinned are skipped)", () => {
  const withPinnedA = () => {
    let s = build("a", "b", "c", "d");
    s = togglePin(s, idOf(s, "a"));
    return s;
  };

  it("closeOthers keeps the id and pinned tabs, activates the id", () => {
    let s = withPinnedA();
    s = closeOthers(s, idOf(s, "c"));
    expect(paths(s)).toEqual(["a", "c"]);
    expect(active(s)).toBe("c");
    expect(s.closed.map((c) => c.tab.path)).toEqual(["b", "d"]);
    assertInvariants(s);
  });

  it("closeOthers with nothing to close is the same state", () => {
    const s = build("a");
    expect(closeOthers(s, s.activeId)).toBe(s);
  });

  it("closeRight closes tabs after the id; active moves to the id", () => {
    let s = withPinnedA();
    s = closeRight(s, idOf(s, "b"));
    expect(paths(s)).toEqual(["a", "b"]);
    expect(active(s)).toBe("b");
    assertInvariants(s);
  });

  it("closeRight keeps a still-active tab", () => {
    let s = withPinnedA();
    s = activate(s, idOf(s, "a"));
    s = closeRight(s, idOf(s, "b"));
    expect(active(s)).toBe("a");
  });

  it("closeAll leaves pinned tabs, or a home tab when none are pinned", () => {
    let s = closeAll(withPinnedA());
    expect(paths(s)).toEqual(["a"]);
    expect(active(s)).toBe("a");
    s = closeAll(build("x", "y"));
    expect(paths(s)).toEqual([null]);
    assertInvariants(s);
  });
});

describe("reopenClosed", () => {
  it("restores at the old index with its view and activates it", () => {
    let s = build("a", "b", "c");
    s = setView(s, idOf(s, "b"), { scrollX: 5, scrollY: 6, zoom: 2 });
    const bId = idOf(s, "b");
    s = close(s, bId);
    s = reopenClosed(s);
    expect(paths(s)).toEqual(["a", "b", "c"]);
    expect(active(s)).toBe("b");
    expect(getActiveTab(s).view).toEqual({ scrollX: 5, scrollY: 6, zoom: 2 });
    expect(s.closed).toEqual([]);
    assertInvariants(s);
  });

  it("clamps the index when the strip shrank", () => {
    let s = build("a", "b", "c");
    s = close(s, idOf(s, "c"));
    s = close(s, idOf(s, "b"));
    s = reopenClosed(s); // b, was index 1
    s = reopenClosed(s); // c, was index 2, clamped
    expect(paths(s)).toEqual(["a", "b", "c"]);
  });

  it("respects pinned-first when the closed tab was unpinned", () => {
    let s = build("a", "b", "c");
    s = close(s, idOf(s, "a")); // a was index 0
    s = togglePin(s, idOf(s, "b"));
    s = reopenClosed(s);
    expect(paths(s)).toEqual(["b", "a", "c"]);
    assertInvariants(s);
  });

  it("when the path is already open, activates it and drops the entry", () => {
    let s = build("a", "b");
    s = close(s, idOf(s, "a"));
    s = openPath(s, "a", { target: "new", focus: false });
    s = reopenClosed(s);
    expect(paths(s)).toEqual(["b", "a"]);
    expect(active(s)).toBe("a");
    expect(s.closed).toEqual([]);
    assertInvariants(s);
  });

  it("empty stack is a no-op", () => {
    const s = build("a");
    expect(reopenClosed(s)).toBe(s);
  });
});

describe("togglePin", () => {
  it("pinned goes to the end of the pinned group, unpinned to the start of the rest", () => {
    let s = build("a", "b", "c", "d");
    s = togglePin(s, idOf(s, "c"));
    expect(paths(s)).toEqual(["c", "a", "b", "d"]);
    s = togglePin(s, idOf(s, "d"));
    expect(paths(s)).toEqual(["c", "d", "a", "b"]);
    s = togglePin(s, idOf(s, "c"));
    expect(paths(s)).toEqual(["d", "c", "a", "b"]);
    expect(s.tabs.map((t) => t.pinned)).toEqual([true, false, false, false]);
    assertInvariants(s);
    expect(togglePin(s, "nope")).toBe(s);
  });
});

describe("move / moveBy", () => {
  it("moves within the unpinned group and clamps bounds", () => {
    let s = build("a", "b", "c", "d");
    s = move(s, idOf(s, "a"), 2);
    expect(paths(s)).toEqual(["b", "c", "a", "d"]);
    s = move(s, idOf(s, "a"), 99);
    expect(paths(s)).toEqual(["b", "c", "d", "a"]);
    s = move(s, idOf(s, "a"), -5);
    expect(paths(s)).toEqual(["a", "b", "c", "d"]);
    expect(move(s, idOf(s, "a"), 0)).toBe(s);
    expect(move(s, "nope", 1)).toBe(s);
  });

  it("never crosses the pinned boundary", () => {
    let s = build("a", "b", "c");
    s = togglePin(s, idOf(s, "a"));
    expect(move(s, idOf(s, "b"), 0)).toBe(s);
    expect(moveBy(s, idOf(s, "b"), -1)).toBe(s);
    expect(moveBy(s, idOf(s, "a"), 1)).toBe(s);
    expect(paths(moveBy(s, idOf(s, "b"), 1))).toEqual(["a", "c", "b"]);
    assertInvariants(moveBy(s, idOf(s, "b"), 1));
  });
});

describe("next / prev / goTo / goToLast", () => {
  it("walks strip order and wraps", () => {
    let s = build("a", "b", "c");
    s = activate(s, idOf(s, "c"));
    expect(active(next(s))).toBe("a");
    expect(active(prev(next(s)))).toBe("c");
    s = activate(s, idOf(s, "a"));
    expect(active(prev(s))).toBe("c");
    const one = build("a");
    expect(next(one)).toBe(one);
    expect(prev(one)).toBe(one);
  });

  it("goTo is 1-based and ignores out of range", () => {
    const s = build("a", "b", "c");
    expect(active(goTo(s, 2))).toBe("b");
    expect(goTo(s, 0)).toBe(s);
    expect(goTo(s, 4)).toBe(s);
    expect(goTo(s, 1.5)).toBe(s);
    expect(active(goToLast(goTo(s, 1)))).toBe("c");
  });
});

describe("mruNext / mruPrev", () => {
  it("tap toggles between the two most recent; twice returns to the start", () => {
    let s = build("a", "b", "c"); // active c, mru c b a
    const once = mruNext(s);
    expect(active(once)).toBe("b");
    const twice = mruNext(once);
    expect(active(twice)).toBe("c");
    expect(twice.mru).toEqual(s.mru);
    s = twice;
    expect(active(mruPrev(s))).toBe("a");
    assertInvariants(mruPrev(s));
  });

  it("single tab is a no-op", () => {
    const s = build("a");
    expect(mruNext(s)).toBe(s);
    expect(mruPrev(s)).toBe(s);
  });
});

describe("renamePath", () => {
  it("renames a file", () => {
    const s = renamePath(
      build("a/b.excalidraw", "c"),
      "a/b.excalidraw",
      "z.excalidraw",
    );
    expect(paths(s)).toEqual(["z.excalidraw", "c"]);
  });

  it("renames a folder prefix but not a sibling sharing the name prefix", () => {
    const s = renamePath(build("a/b/x", "a/bc/y", "a/b"), "a/b", "q");
    expect(paths(s)).toEqual(["q/x", "a/bc/y", "q"]);
    assertInvariants(s);
  });

  it("updates the closed stack too", () => {
    let s = build("a/b/x", "a/bc/y", "k");
    s = close(s, idOf(s, "a/b/x"));
    s = close(s, idOf(s, "a/bc/y"));
    s = renamePath(s, "a/b", "q");
    expect(s.closed.map((c) => c.tab.path)).toEqual(["q/x", "a/bc/y"]);
  });

  it("returns the same state when nothing matches", () => {
    const s = build("a", "b");
    expect(renamePath(s, "zzz", "y")).toBe(s);
    expect(renamePath(s, "a", "a")).toBe(s);
  });
});

describe("removePath", () => {
  it("closes the file's tab without a closed entry and drops stale entries", () => {
    let s = build("a", "b", "c");
    s = close(s, idOf(s, "a"));
    s = removePath(s, "b");
    expect(paths(s)).toEqual(["c"]);
    expect(s.closed.map((c) => c.tab.path)).toEqual(["a"]);
    s = removePath(s, "a");
    expect(s.closed).toEqual([]);
    assertInvariants(s);
  });

  it("removes a folder's tabs only (not a sibling prefix)", () => {
    let s = build("d/x", "d/y", "dd/z", "d");
    s = removePath(s, "d");
    expect(paths(s)).toEqual(["dd/z"]);
    expect(s.closed).toEqual([]);
  });

  it("activates the MRU previous tab if the active one goes", () => {
    let s = build("a", "b", "c");
    s = activate(s, idOf(s, "a"));
    s = activate(s, idOf(s, "b"));
    s = removePath(s, "b");
    expect(active(s)).toBe("a");
  });

  it("never leaves zero tabs; no match is the same state", () => {
    const s = build("a");
    expect(paths(removePath(s, "a"))).toEqual([null]);
    expect(removePath(s, "nope")).toBe(s);
  });
});

describe("setMissing / setView", () => {
  it("marks by exact path or folder prefix", () => {
    let s = build("d/x", "d/y", "dd/z");
    s = setMissing(s, "d", true);
    expect(s.tabs.map((t) => t.missing)).toEqual([true, true, false]);
    s = setMissing(s, "d/x", false);
    expect(s.tabs.map((t) => t.missing)).toEqual([false, true, false]);
  });

  it("is a no-op when nothing changes", () => {
    const s = build("a");
    expect(setMissing(s, "a", false)).toBe(s);
    expect(setMissing(s, "zz", true)).toBe(s);
  });

  it("setView stores the view; equal view or unknown id is a no-op", () => {
    const s = build("a");
    const v = { scrollX: 1, scrollY: 2, zoom: 1 };
    const s2 = setView(s, s.activeId, v);
    expect(getActiveTab(s2).view).toEqual(v);
    expect(setView(s2, s.activeId, { ...v })).toBe(s2);
    expect(setView(s2, "nope", v)).toBe(s2);
  });
});

describe("property: invariants under random operations", () => {
  const rng = (seed: number) => () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };

  it("holds after 1,000 seeded random operations", () => {
    const rand = rng(12345);
    const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];
    const folders = ["a", "ab", "b"];
    const randPath = () => `${pick(folders)}/f${Math.floor(rand() * 12)}`;
    let s = initialState();
    for (let i = 0; i < 1000; i++) {
      const id = pick(s.tabs).id;
      switch (Math.floor(rand() * 22)) {
        case 0:
        case 1:
          s = openPath(s, randPath(), {
            target: "new",
            focus: rand() < 0.7,
            position: rand() < 0.5 ? "end" : "after_active",
          });
          break;
        case 2:
        case 3:
          s = openPath(s, randPath(), CUR);
          break;
        case 4:
          s = newTab(s);
          break;
        case 5:
          s = activate(s, id);
          break;
        case 6:
          s = close(s, id);
          break;
        case 7:
          s = closeOthers(s, id);
          break;
        case 8:
          s = closeRight(s, id);
          break;
        case 9:
          s = rand() < 0.2 ? closeAll(s) : s;
          break;
        case 10:
          s = reopenClosed(s);
          break;
        case 11:
          s = togglePin(s, id);
          break;
        case 12:
          s = move(s, id, Math.floor(rand() * 14) - 2);
          break;
        case 13:
          s = moveBy(s, id, rand() < 0.5 ? 1 : -1);
          break;
        case 14:
          s = next(s);
          break;
        case 15:
          s = prev(s);
          break;
        case 16:
          s = rand() < 0.5 ? mruNext(s) : mruPrev(s);
          break;
        case 17:
          s = renamePath(s, pick(folders), `${pick(folders)}x`);
          break;
        case 18:
          s = removePath(s, rand() < 0.3 ? pick(folders) : randPath());
          break;
        case 19:
          s = setMissing(s, randPath(), rand() < 0.5);
          break;
        case 20:
          s = goTo(s, Math.floor(rand() * 8));
          break;
        default:
          s = setView(s, id, { scrollX: i, scrollY: 0, zoom: 1 });
      }
      assertInvariants(s);
    }
  });
});

describe("micro-benchmark", () => {
  it("openPath and close on a 50-tab state are far below 1 ms", () => {
    let base = initialState();
    for (let i = 0; i < 50; i++) {
      base = openPath(base, `dir/f${i}`, { target: "new", position: "end" });
    }
    const ops = 1000;
    const t0 = performance.now();
    for (let i = 0; i < ops; i++) {
      const opened = openPath(base, `dir/n${i}`, NEW);
      close(opened, opened.activeId);
    }
    const avg = (performance.now() - t0) / (ops * 2);
    // eslint-disable-next-line no-console
    console.log(
      `tabsModel bench: ${(avg * 1000).toFixed(1)} us per op (50 tabs)`,
    );
    expect(avg).toBeLessThan(0.2);
  });
});

describe("renamePath collisions", () => {
  it("drops the renamed tab when its new path is already open", () => {
    const s = renamePath(build("a", "b"), "a", "b");
    expect(paths(s)).toEqual(["b"]);
    assertInvariants(s);
  });
});

describe("fromSession", () => {
  it("builds a valid state with the saved active tab and MRU", () => {
    const s = fromSession({
      tabs: [
        { path: "p.excalidraw", pinned: true },
        {
          path: "a.excalidraw",
          pinned: false,
          view: { scrollX: 1, scrollY: 2, zoom: 1.5 },
        },
        { path: null, pinned: false },
      ],
      activeIndex: 1,
      mru: [1, 2, 0],
    });
    assertInvariants(s);
    expect(getActiveTab(s).path).toBe("a.excalidraw");
    expect(getActiveTab(s).view?.zoom).toBe(1.5);
    expect(s.mru).toEqual(["t2", "t3", "t1"]);
    expect(newTab(s).activeId).toBe("t4");
  });

  it("falls back to one home tab when empty", () => {
    const s = fromSession({ tabs: [], activeIndex: 0, mru: [] });
    assertInvariants(s);
    expect(s.tabs).toHaveLength(1);
  });
});
