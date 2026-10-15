/**
 * The same HistoryRepository cases run against the in-memory Fake and against
 * DesktopHistoryRepository with a mocked invoke. The mocked "native side" is a
 * Fake behind the real wire shapes (camelCase args, raw frames, raw bytes), so
 * the Desktop adapter's argument mapping and decoding are checked end to end.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DesktopHistoryRepository } from "../history/DesktopHistoryRepository";

import { FakeHistoryRepository } from "./fakeHistoryRepository";

import type {
  HistoryChange,
  HistoryRepository,
  HistorySettings,
} from "../history/types";

const SETTINGS: HistorySettings = {
  enabled: true,
  intervalMinutes: 5,
  keepAllHours: 1,
  keepHourlyHours: 24,
  keepDailyDays: 30,
  keepWeeklyWeeks: 0,
  sizeCapMb: 500,
  highlightChanges: true,
};

const H = "h1";
const P = "a.excalidraw";
const scene = (n: number, pad = 0) =>
  JSON.stringify({
    type: "excalidraw",
    elements: Array.from({ length: n }, (_, i) => ({ id: `e${i}` })),
    pad: "x".repeat(pad),
  });
const BIG = scene(200, 8000);

interface Rig {
  repo: HistoryRepository;
  fake: FakeHistoryRepository;
  copies: Array<{ path: string; json: string }>;
  invoke?: ReturnType<typeof vi.fn>;
}

const makeFake = (): Rig => {
  const copies: Rig["copies"] = [];
  const fake = new FakeHistoryRepository(H, {
    createCopy: async (path, json) => {
      copies.push({ path, json });
      return { revision: "copy-rev" };
    },
  });
  return { repo: fake, fake, copies };
};

const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer =>
  bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;

const makeDesktop = (): Rig => {
  const rig = makeFake();
  const listeners: Array<(e: { payload: HistoryChange }) => void> = [];
  rig.fake.subscribe((e) => listeners.forEach((l) => l({ payload: e })));
  const enc = new TextEncoder();
  const invoke = vi.fn(
    async (
      cmd: string,
      args?: Record<string, any> | Uint8Array,
      options?: { headers?: Record<string, string> },
    ): Promise<any> => {
      const a = (args ?? {}) as Record<string, any>;
      switch (cmd) {
        case "history_configure":
          return rig.fake.configure(a.handle, a.settings);
        case "history_status":
          return rig.fake.status(a.handle);
        case "history_opened":
          return rig.fake.opened(a.handle, a.path, a.revision);
        case "history_list":
          return rig.fake.list(a.handle, a.path);
        case "history_snapshot":
          return rig.fake.snapshot(a.handle, a.path, a.reason, a.wait);
        case "history_snapshot_bytes": {
          const h = options!.headers!;
          const d = decodeURIComponent;
          return rig.fake.snapshotBytes(
            d(h["x-handle"]),
            d(h["x-path"]),
            d(h["x-reason"]) as any,
            d(h["x-revision"]),
            new TextDecoder().decode(args as Uint8Array),
          );
        }
        case "history_checkpoint":
          return rig.fake.checkpoint(a.handle, a.path, a.name, a.note);
        case "history_read_version": {
          const { meta, json } = await rig.fake.readVersion(a.handle, a.id);
          return toArrayBuffer(enc.encode(`${JSON.stringify(meta)}\n${json}`));
        }
        case "history_read_blob":
          return toArrayBuffer(await rig.fake.readBlob(a.handle, a.blob));
        case "history_restore_copy":
          return rig.fake.restoreCopy(a.handle, a.id);
        case "history_export_file":
          return rig.fake.exportFile(a.handle, a.id);
        case "history_delete_checkpoint":
          return rig.fake.deleteCheckpoint(a.handle, a.id);
        case "history_delete_all":
          return rig.fake.deleteAll(a.handle, a.path);
        case "history_exclude_from_git":
          return rig.fake.excludeFromGit(a.handle);
        default:
          throw new Error(`unknown command ${cmd}`);
      }
    },
  );
  const listen = vi.fn(async (event: string, handler: any) => {
    expect(event).toBe("history-change");
    listeners.push(handler);
    return () => {
      listeners.splice(listeners.indexOf(handler), 1);
    };
  });
  return {
    ...rig,
    repo: new DesktopHistoryRepository({
      invoke: invoke as any,
      listen: listen as any,
    }),
    invoke,
  };
};

describe.each([
  ["Fake", makeFake],
  ["Desktop (mocked invoke)", makeDesktop],
])("HistoryRepository contract: %s", (_name, make) => {
  let rig: Rig;
  beforeEach(async () => {
    rig = make();
    await rig.repo.configure(H, SETTINGS);
  });

  it("starts with an empty, enabled listing", async () => {
    const listing = await rig.repo.list(H, P);
    expect(listing).toMatchObject({
      path: P,
      versions: [],
      lastVersionAt: null,
      enabled: true,
      readOnly: false,
      formatNewer: false,
    });
  });

  it("reports status", async () => {
    expect(await rig.repo.status(H)).toMatchObject({
      handle: H,
      state: "idle",
      overCap: "none",
    });
  });

  it("creates checkpoints from committed state and lists newest first", async () => {
    rig.fake.noteCommitted(H, P, scene(2));
    const first = await rig.repo.checkpoint(H, P, "v1", "first note");
    rig.fake.noteCommitted(H, P, scene(3));
    const second = await rig.repo.checkpoint(H, P, "v2", "");
    expect(first).toMatchObject({
      reason: "checkpoint",
      name: "v1",
      note: "first note",
      ownDevice: true,
      elementCount: 2,
    });
    expect(second.note).toBeNull();
    const listing = await rig.repo.list(H, P);
    expect(listing.versions.map((v) => v.name)).toEqual(["v2", "v1"]);
    expect(listing.lastVersionAt).toBe(listing.versions[0].createdAt);
  });

  it("rejects an empty or oversize checkpoint name", async () => {
    rig.fake.noteCommitted(H, P, scene(1));
    await expect(rig.repo.checkpoint(H, P, "  ", "")).rejects.toBeDefined();
    await expect(
      rig.repo.checkpoint(H, P, "x".repeat(121), ""),
    ).rejects.toBeDefined();
  });

  it("applies the shrink rule: a clear versions the previous state", async () => {
    rig.fake.noteCommitted(H, P, BIG);
    rig.fake.noteCommitted(H, P, scene(0));
    const { versions } = await rig.repo.list(H, P);
    expect(versions).toHaveLength(1);
    expect(versions[0].reason).toBe("before-clear");
    const read = await rig.repo.readVersion(H, versions[0].id);
    expect(read.json).toBe(BIG);
  });

  it("does not apply the shrink rule to small drawings or small drops", async () => {
    rig.fake.noteCommitted(H, P, scene(5));
    rig.fake.noteCommitted(H, P, scene(0));
    rig.fake.noteCommitted(H, "b.excalidraw", BIG);
    rig.fake.noteCommitted(H, "b.excalidraw", BIG.slice(0, BIG.length * 0.7));
    expect((await rig.repo.list(H, P)).versions).toHaveLength(0);
    expect((await rig.repo.list(H, "b.excalidraw")).versions).toHaveLength(0);
  });

  it("versions the left drawing when another is opened (leave), only if dirty", async () => {
    await rig.repo.opened(H, P, "r1");
    rig.fake.noteCommitted(H, P, scene(2));
    await rig.repo.opened(H, "b.excalidraw", "r2");
    expect((await rig.repo.list(H, P)).versions.map((v) => v.reason)).toEqual([
      "leave",
    ]);
    await rig.repo.opened(H, null, null);
    expect((await rig.repo.list(H, "b.excalidraw")).versions).toHaveLength(0);
  });

  it("snapshot: before-restore when dirty, skipped when clean", async () => {
    rig.fake.noteCommitted(H, P, scene(2));
    const done = await rig.repo.snapshot(H, P, "before-restore", true);
    expect(done.id).toBeTruthy();
    const again = await rig.repo.snapshot(H, P, "before-restore", true);
    expect(again).toEqual({ id: null, skipped: "clean" });
    expect((await rig.repo.list(H, P)).versions[0].reason).toBe(
      "before-restore",
    );
  });

  it("snapshotBytes stores the given text and skips an identical one", async () => {
    const json = scene(4);
    const done = await rig.repo.snapshotBytes(
      H,
      P,
      "discarded-edits",
      "r1",
      json,
    );
    expect(done.id).toBeTruthy();
    expect((await rig.repo.readVersion(H, done.id!)).json).toBe(json);
    const dup = await rig.repo.snapshotBytes(
      H,
      P,
      "discarded-edits",
      "r1",
      json,
    );
    expect(dup.id).toBeNull();
    expect(dup.skipped).toBeTruthy();
    const accents = scene(1, 0).replace("excalidraw", "excalidraw ✓ é \\n");
    const s2 = await rig.repo.snapshotBytes(
      H,
      P,
      "before-outside-change",
      "r2",
      accents,
    );
    expect((await rig.repo.readVersion(H, s2.id!)).json).toBe(accents);
  });

  it("reads a version with meta and exact JSON (multi-byte safe)", async () => {
    const json = scene(1).replace("excalidraw", "excalidraw 日本 ✓");
    rig.fake.noteCommitted(H, P, json);
    const cp = await rig.repo.checkpoint(H, P, "n", "");
    const read = await rig.repo.readVersion(H, cp.id);
    expect(read.json).toBe(json);
    expect(read.meta).toMatchObject({ id: cp.id, exact: true });
    expect(read.meta.fileRevision).toMatch(/^[0-9a-f]{64}$/);
  });

  it("reports a missing version as VERSION_GONE", async () => {
    await expect(rig.repo.readVersion(H, "nope")).rejects.toMatchObject({
      code: "VERSION_GONE",
    });
  });

  it("reads blobs as bytes and reports a missing blob", async () => {
    rig.fake.putBlob("abc.png", new Uint8Array([1, 2, 3, 255]));
    expect([...(await rig.repo.readBlob(H, "abc.png"))]).toEqual([
      1, 2, 3, 255,
    ]);
    await expect(rig.repo.readBlob(H, "zzz.png")).rejects.toMatchObject({
      code: "VERSION_GONE",
    });
  });

  it("restores as a copy at a new path and exports", async () => {
    rig.fake.noteCommitted(H, P, scene(2));
    const cp = await rig.repo.checkpoint(H, P, "n", "");
    const copy = await rig.repo.restoreCopy(H, cp.id);
    expect(copy.path).not.toBe(P);
    expect(copy.path.endsWith(".excalidraw")).toBe(true);
    expect(copy.revision).toBeTruthy();
    expect(rig.copies).toEqual([{ path: copy.path, json: scene(2) }]);
    await expect(rig.repo.exportFile(H, cp.id)).resolves.toBe(true);
  });

  it("deletes a checkpoint but refuses automatic versions", async () => {
    rig.fake.noteCommitted(H, P, BIG);
    rig.fake.noteCommitted(H, P, scene(0));
    const auto = (await rig.repo.list(H, P)).versions[0];
    await expect(rig.repo.deleteCheckpoint(H, auto.id)).rejects.toBeDefined();
    const cp = await rig.repo.checkpoint(H, P, "n", "");
    await rig.repo.deleteCheckpoint(H, cp.id);
    expect((await rig.repo.list(H, P)).versions.map((v) => v.id)).toEqual([
      auto.id,
    ]);
  });

  it("deletes all history of a drawing and nothing else", async () => {
    rig.fake.noteCommitted(H, P, scene(2));
    rig.fake.noteCommitted(H, "b.excalidraw", scene(2));
    await rig.repo.checkpoint(H, P, "a", "");
    await rig.repo.checkpoint(H, "b.excalidraw", "b", "");
    await rig.repo.deleteAll(H, P);
    expect((await rig.repo.list(H, P)).versions).toHaveLength(0);
    expect((await rig.repo.list(H, "b.excalidraw")).versions).toHaveLength(1);
  });

  it("excludes from git without error", async () => {
    await expect(rig.repo.excludeFromGit(H)).resolves.toBeUndefined();
  });

  it("notifies subscribers about changed paths until unsubscribed", async () => {
    const events: HistoryChange[] = [];
    const off = await rig.repo.subscribe((e) => events.push(e));
    rig.fake.noteCommitted(H, P, scene(2));
    await rig.repo.checkpoint(H, P, "n", "");
    expect(events).toEqual([{ handle: H, paths: [P] }]);
    off();
    await rig.repo.checkpoint(H, P, "m", "");
    expect(events).toHaveLength(1);
  });

  it("is off when disabled: no versions, HISTORY_OFF on checkpoint", async () => {
    await rig.repo.configure(H, { ...SETTINGS, enabled: false });
    rig.fake.noteCommitted(H, P, BIG);
    rig.fake.noteCommitted(H, P, scene(0));
    expect((await rig.repo.list(H, P)).enabled).toBe(false);
    expect((await rig.repo.list(H, P)).versions).toHaveLength(0);
    await expect(rig.repo.checkpoint(H, P, "n", "")).rejects.toMatchObject({
      code: "HISTORY_OFF",
    });
    expect(await rig.repo.snapshot(H, P, "leave", false)).toEqual({
      id: null,
      skipped: "off",
    });
  });
});

describe("Desktop wire format", () => {
  it("sends camelCase args and the raw snapshot body with percent-encoded headers", async () => {
    const invoke = vi.fn().mockResolvedValue({ id: "x", skipped: null });
    const repo = new DesktopHistoryRepository({ invoke: invoke as any });
    await repo.configure("h/1", SETTINGS);
    expect(invoke).toHaveBeenLastCalledWith(
      "history_configure",
      { handle: "h/1", settings: SETTINGS },
      undefined,
    );
    await repo.opened("h/1", null, null);
    expect(invoke).toHaveBeenLastCalledWith(
      "history_opened",
      { handle: "h/1", path: null, revision: null },
      undefined,
    );
    await repo.snapshot("h", "a.excalidraw", "leave", false);
    expect(invoke).toHaveBeenLastCalledWith(
      "history_snapshot",
      { handle: "h", path: "a.excalidraw", reason: "leave", wait: false },
      undefined,
    );
    const json = '{"t":"✓"}';
    await repo.snapshotBytes(
      "h/1",
      "föld/a b.excalidraw",
      "discarded-edits",
      "r 1",
      json,
    );
    const [cmd, body, options] = invoke.mock.calls.at(-1)!;
    expect(cmd).toBe("history_snapshot_bytes");
    expect(ArrayBuffer.isView(body)).toBe(true);
    expect(new TextDecoder().decode(body)).toBe(json);
    expect(options.headers).toEqual({
      "x-handle": "h%2F1",
      "x-path": encodeURIComponent("föld/a b.excalidraw"),
      "x-reason": "discarded-edits",
      "x-revision": "r%201",
    });
  });

  it("normalizes native errors to {code, message}", async () => {
    const repo = new DesktopHistoryRepository({
      invoke: vi
        .fn()
        .mockRejectedValue({ code: "HISTORY_DISK_LOW", message: "disk low" }),
    });
    await expect(repo.checkpoint("h", "a", "n", "")).rejects.toMatchObject({
      code: "HISTORY_DISK_LOW",
      message: "disk low",
    });
  });

  it("rejects a malformed version frame", async () => {
    const repo = new DesktopHistoryRepository({
      invoke: vi
        .fn()
        .mockResolvedValue(new TextEncoder().encode("no newline").buffer),
    });
    await expect(repo.readVersion("h", "id")).rejects.toMatchObject({
      code: "VERSION_CORRUPT",
    });
  });
});
