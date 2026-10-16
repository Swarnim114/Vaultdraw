import { restoreElements } from "@excalidraw/excalidraw";
import { describe, expect, it, vi } from "vitest";

import {
  buildReplaceElements,
  copySelectionInto,
  exportVersionFile,
  fileLevelAppState,
  replaceRefusal,
  restoreCopy,
  restoreReplace,
} from "../history/restore";

import { FakeHistoryRepository } from "./fakeHistoryRepository";

import type { RestoreState } from "../history/restore";
import type { LoadedVersion } from "../history/preview/versionCache";

const el = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  type: "rectangle",
  x: 0,
  y: 0,
  width: 10,
  height: 10,
  version: 1,
  ...extra,
});

const make = (raw: Array<Record<string, unknown>>) =>
  restoreElements(raw as any, null) as any[];

const loaded = (
  raw: Array<Record<string, unknown>>,
  extra: Partial<LoadedVersion> = {},
): LoadedVersion => {
  const elements = make(raw);
  return {
    id: "v1",
    fileRevision: "rev",
    elements,
    appState: {},
    files: {},
    imagesLoaded: true,
    elementCount: elements.length,
    ...extra,
  };
};

const fakeApi = (
  current: any[],
  files: Record<string, any> = {},
  selected: string[] = [],
) => {
  const api = {
    getSceneElementsIncludingDeleted: () => current,
    getFiles: () => files,
    getAppState: () => ({
      selectedElementIds: Object.fromEntries(selected.map((id) => [id, true])),
    }),
    addFiles: vi.fn(),
    updateScene: vi.fn(),
  };
  return api as typeof api & any;
};

const OK: RestoreState = { status: "saved", deleted: false, readOnly: false };

describe("replaceRefusal", () => {
  it("refuses conflict, deleted and read-only, otherwise null", () => {
    expect(replaceRefusal(OK)).toBeNull();
    expect(replaceRefusal({ ...OK, status: "dirty" })).toBeNull();
    expect(replaceRefusal({ ...OK, status: "conflict" })).toBe("conflict");
    expect(replaceRefusal({ ...OK, deleted: true })).toBe("deleted");
    expect(replaceRefusal({ ...OK, readOnly: true })).toBe("read-only");
  });
});

describe("buildReplaceElements", () => {
  it("bumps version past both sides with a new nonce", () => {
    const cur = make([el("a", { version: 7, versionNonce: 1 })]);
    const ver = make([el("a", { version: 3, versionNonce: 2, x: 50 })]);
    const [out] = buildReplaceElements(cur, ver);
    expect(out.x).toBe(50);
    expect(out.version).toBe(Math.max(cur[0].version, ver[0].version) + 1);
    expect(out.versionNonce).not.toBe(2);
    expect(out.versionNonce).not.toBe(1);
    const low = make([el("a", { version: 1 })]);
    const high = make([el("a", { version: 9 })]);
    expect(buildReplaceElements(low, high)[0].version).toBe(
      high[0].version + 1,
    );
  });

  it("keeps live current elements missing from the version as deleted, after the version's", () => {
    const cur = make([
      el("a"),
      el("b", { version: 4 }),
      el("c", { isDeleted: true }),
    ]);
    const ver = make([el("z"), el("a")]);
    const out = buildReplaceElements(cur, ver);
    expect(out.map((e) => e.id)).toEqual(["z", "a", "b", "c"]);
    expect(out[2]).toMatchObject({
      id: "b",
      isDeleted: true,
      version: cur[1].version + 1,
    });
    expect(out[3]).toMatchObject({
      id: "c",
      isDeleted: true,
      version: cur[2].version,
    });
  });

  it("does not mutate its inputs", () => {
    const cur = make([el("b")]);
    const ver = make([el("a")]);
    const before = JSON.stringify([cur, ver]);
    buildReplaceElements(cur, ver);
    expect(JSON.stringify([cur, ver])).toBe(before);
  });
});

describe("fileLevelAppState", () => {
  it("keeps background and page fields only", () => {
    const out = fileLevelAppState({
      viewBackgroundColor: "#111111",
      viewBackgroundPattern: null,
      pageSetup: { browser: true } as any,
      scrollX: 5,
      scrollY: 6,
      zoom: { value: 2 } as any,
      selectedElementIds: { a: true },
      activeTool: { type: "arrow" } as any,
    });
    expect(Object.keys(out).sort()).toEqual([
      "pageSetup",
      "viewBackgroundColor",
      "viewBackgroundPattern",
    ]);
  });

  it("omits fields the version does not carry", () => {
    expect(fileLevelAppState({ scrollX: 1 })).toEqual({});
  });
});

describe("restoreReplace", () => {
  const setup = async (state: () => RestoreState = () => ({ ...OK })) => {
    const repository = new FakeHistoryRepository("h");
    await repository.configure("h", { enabled: true } as any);
    const snapshot = vi.spyOn(repository, "snapshot");
    const order: string[] = [];
    const flush = vi.fn(async () => {
      order.push("flush");
    });
    snapshot.mockImplementation(async () => {
      order.push("snapshot");
      return { id: "s", skipped: null };
    });
    const api = fakeApi(make([el("b")]), { have: { id: "have" } });
    api.updateScene.mockImplementation(() => order.push("update"));
    const deps = {
      repository,
      handle: "h",
      path: "a.excalidraw",
      flush,
      api,
      state,
    };
    return { deps, api, snapshot, flush, order };
  };

  it("flushes, snapshots (awaited), then replaces undoably", async () => {
    const { deps, api, order, snapshot } = await setup();
    const version = loaded([el("a")], {
      appState: { viewBackgroundColor: "#222222", scrollX: 9 } as any,
      files: {
        have: { id: "have" } as any,
        new1: { id: "new1" } as any,
      },
    });
    await restoreReplace(deps, version);
    expect(order).toEqual(["flush", "snapshot", "update"]);
    expect(snapshot).toHaveBeenCalledWith(
      "h",
      "a.excalidraw",
      "before-restore",
      true,
    );
    const call = api.updateScene.mock.calls[0][0];
    expect(call.captureUpdate).toBe("IMMEDIATELY");
    expect(call.appState).toEqual({ viewBackgroundColor: "#222222" });
    expect(call.elements.map((e: any) => [e.id, !!e.isDeleted])).toEqual([
      ["a", false],
      ["b", true],
    ]);
    expect(api.addFiles).toHaveBeenCalledWith([{ id: "new1" }]);
  });

  it.each([
    [{ ...OK, status: "conflict" as const }, /conflicting/],
    [{ ...OK, deleted: true }, /deleted/],
    [{ ...OK, readOnly: true }, /read-only/],
  ])("refuses %o without flushing or touching anything", async (state, msg) => {
    const { deps, api, flush, snapshot } = await setup(() => state);
    await expect(restoreReplace(deps, loaded([el("a")]))).rejects.toMatchObject(
      {
        code: "RESTORE_REFUSED",
        message: expect.stringMatching(msg),
      },
    );
    expect(flush).not.toHaveBeenCalled();
    expect(snapshot).not.toHaveBeenCalled();
    expect(api.updateScene).not.toHaveBeenCalled();
  });

  it("refuses when a conflict appears while flushing", async () => {
    let status: "saved" | "conflict" = "saved";
    const { deps, api, snapshot, flush } = await setup(() => ({
      ...OK,
      status,
    }));
    flush.mockImplementation(async () => {
      status = "conflict";
    });
    await expect(restoreReplace(deps, loaded([el("a")]))).rejects.toThrow();
    expect(snapshot).not.toHaveBeenCalled();
    expect(api.updateScene).not.toHaveBeenCalled();
  });

  it("aborts without updateScene when the safety snapshot fails", async () => {
    const { deps, api, snapshot } = await setup();
    snapshot.mockRejectedValue(new Error("disk full"));
    await expect(restoreReplace(deps, loaded([el("a")]))).rejects.toThrow(
      "disk full",
    );
    expect(api.updateScene).not.toHaveBeenCalled();
    expect(api.addFiles).not.toHaveBeenCalled();
  });
});

describe("copySelectionInto", () => {
  it("restores ids missing or deleted in main under their id with a newer version", () => {
    const tomb = make([el("gone", { isDeleted: true, version: 6 })]);
    const main = fakeApi(tomb);
    const preview = fakeApi([], {}, ["gone", "fresh"]);
    const version = loaded([
      el("gone", { version: 2 }),
      el("fresh"),
      el("other"),
    ]);
    const added = copySelectionInto(main, preview, version);
    expect(added).toBe(2);
    const call = main.updateScene.mock.calls[0][0];
    expect(call.captureUpdate).toBe("IMMEDIATELY");
    const byId = new Map(call.elements.map((e: any) => [e.id, e]));
    expect(byId.get("gone")).toMatchObject({
      isDeleted: false,
      version: tomb[0].version + 1,
    });
    expect(byId.has("fresh")).toBe(true);
    expect(byId.has("other")).toBe(false);
    expect(call.elements).toHaveLength(2);
    expect(call.appState.selectedElementIds).toEqual({
      gone: true,
      fresh: true,
    });
  });

  it("duplicates ids that are live in main, with new ids, and leaves main's own untouched", () => {
    const liveMain = make([el("a", { x: 100 })]);
    const main = fakeApi(liveMain);
    const preview = fakeApi([], {}, ["a"]);
    const added = copySelectionInto(main, preview, loaded([el("a", { x: 5 })]));
    expect(added).toBe(1);
    const call = main.updateScene.mock.calls[0][0];
    expect(call.elements).toHaveLength(2);
    expect(call.elements[0]).toBe(liveMain[0]);
    const dup = call.elements[1];
    expect(dup.id).not.toBe("a");
    expect(dup.x).toBe(15);
    expect(call.appState.selectedElementIds).toEqual({ [dup.id]: true });
  });

  it("remaps bound text and group ids of duplicates together", () => {
    const main = fakeApi(make([el("box"), el("txt")]));
    const preview = fakeApi([], {}, ["box"]);
    const version = loaded([
      el("box", {
        groupIds: ["g1"],
        boundElements: [{ id: "txt", type: "text" }],
      }),
      el("txt", {
        type: "text",
        text: "hi",
        originalText: "hi",
        containerId: "box",
        groupIds: ["g1"],
      }),
    ]);
    expect(copySelectionInto(main, preview, version)).toBe(2);
    const added = main.updateScene.mock.calls[0][0].elements.slice(2);
    const box = added.find((e: any) => e.type === "rectangle");
    const txt = added.find((e: any) => e.type === "text");
    expect([box.id, txt.id]).not.toContain("box");
    expect(txt.containerId).toBe(box.id);
    expect(box.boundElements).toEqual([{ id: txt.id, type: "text" }]);
    expect(box.groupIds[0]).not.toBe("g1");
    expect(box.groupIds).toEqual(txt.groupIds);
  });

  it("drops bindings to elements that are not part of the copy", () => {
    const main = fakeApi([]);
    const preview = fakeApi([], {}, ["arr"]);
    const version = loaded([
      el("target"),
      el("arr", {
        type: "arrow",
        points: [
          [0, 0],
          [10, 10],
        ],
        startBinding: { elementId: "target", focus: 0, gap: 1 },
        endBinding: null,
      }),
    ]);
    copySelectionInto(main, preview, version);
    const [arrow] = main.updateScene.mock.calls[0][0].elements;
    expect(arrow.startBinding).toBeNull();
  });

  it("adds only the image files main is missing", () => {
    const main = fakeApi([], { have: { id: "have" } });
    const preview = fakeApi([], {}, ["i1", "i2"]);
    const version = loaded(
      [
        el("i1", { type: "image", fileId: "have", status: "saved" }),
        el("i2", { type: "image", fileId: "need", status: "saved" }),
        el("x", { type: "image", fileId: "unused", status: "saved" }),
      ],
      {
        files: {
          have: { id: "have" } as any,
          need: { id: "need" } as any,
          unused: { id: "unused" } as any,
        },
      },
    );
    copySelectionInto(main, preview, version);
    expect(main.addFiles).toHaveBeenCalledWith([{ id: "need" }]);
  });

  it("ignores deleted version elements and an empty selection", () => {
    const main = fakeApi([]);
    expect(
      copySelectionInto(
        main,
        fakeApi([], {}, ["d"]),
        loaded([el("d", { isDeleted: true })]),
      ),
    ).toBe(0);
    expect(
      copySelectionInto(main, fakeApi([], {}, []), loaded([el("a")])),
    ).toBe(0);
    expect(main.updateScene).not.toHaveBeenCalled();
  });
});

describe("repository wrappers", () => {
  it("restoreCopy and exportVersionFile delegate", async () => {
    const repository = new FakeHistoryRepository("h");
    const v = repository.inject("a.excalidraw", "{}");
    await expect(restoreCopy(repository, "h", v.id)).resolves.toMatchObject({
      path: expect.stringContaining("restored"),
    });
    await expect(exportVersionFile(repository, "h", v.id)).resolves.toBe(true);
  });
});
