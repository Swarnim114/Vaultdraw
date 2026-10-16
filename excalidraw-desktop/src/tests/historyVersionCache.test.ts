import { describe, expect, it, vi } from "vitest";

import { createVersionCache } from "../history/preview/versionCache";

import { FakeHistoryRepository } from "./fakeHistoryRepository";

const HANDLE = "fake-handle-1";
const SHA = "a".repeat(64);

const rect = (id: string) => ({
  id,
  type: "rectangle",
  x: 0,
  y: 0,
  width: 10,
  height: 10,
});

const scene = (
  ids: string[],
  files: Record<string, unknown> = {},
  extra = {},
) =>
  JSON.stringify({
    type: "excalidraw",
    version: 2,
    elements: ids.map(rect),
    appState: { viewBackgroundColor: "#eeeeee", scrollX: 99, ...extra },
    files,
  });

const imageScene = (fileId: string, dataURL: string) =>
  JSON.stringify({
    type: "excalidraw",
    version: 2,
    elements: [{ ...rect("img"), type: "image", fileId, status: "saved" }],
    appState: {},
    files: {
      [fileId]: { id: fileId, mimeType: "image/png", dataURL, created: 1 },
    },
  });

const setup = (mainFiles: () => any = () => undefined, capacity?: number) => {
  const repo = new FakeHistoryRepository(HANDLE);
  const cache = createVersionCache({
    repository: repo,
    handle: HANDLE,
    mainFiles,
    capacity,
  });
  return { repo, cache };
};

describe("version cache", () => {
  it("parses elements and keeps only file-level app state", async () => {
    const { repo, cache } = setup();
    const v = repo.inject("a.excalidraw", scene(["r1", "r2"]));
    const loaded = await cache.load(v.id, { images: false });
    expect(loaded.elementCount).toBe(2);
    expect(loaded.elements.map((e) => e.id)).toEqual(["r1", "r2"]);
    expect(loaded.appState.viewBackgroundColor).toBe("#eeeeee");
    expect(loaded.appState).not.toHaveProperty("scrollX");
    expect(loaded.files).toEqual({});
    expect(loaded.imagesLoaded).toBe(false);
    expect(loaded.fileRevision).toHaveLength(64);
  });

  it("keeps the 3 most recent versions and evicts the least recent", async () => {
    const { repo, cache } = setup();
    const ids = [1, 2, 3, 4].map(
      (n) => repo.inject("a.excalidraw", scene([`r${n}`])).id,
    );
    for (const id of ids) {
      await cache.load(id, { images: false });
    }
    expect(cache.peek(ids[0])).toBeUndefined();
    expect(ids.slice(1).every((id) => cache.peek(id))).toBe(true);
    // Touching the oldest survivor protects it from the next eviction.
    await cache.load(ids[1], { images: false });
    const extra = repo.inject("a.excalidraw", scene(["r5"])).id;
    await cache.load(extra, { images: false });
    expect(cache.peek(ids[1])).toBeDefined();
    expect(cache.peek(ids[2])).toBeUndefined();
  });

  it("parses once: cached and concurrent loads share one fetch", async () => {
    const { repo, cache } = setup();
    const v = repo.inject("a.excalidraw", scene(["r1"]));
    const [a, b] = await Promise.all([
      cache.load(v.id, { images: false }),
      cache.load(v.id, { images: false }),
    ]);
    await cache.load(v.id, { images: false });
    expect(a).toBe(b);
    expect(repo.calls.filter((c) => c === "readVersion")).toHaveLength(1);
  });

  it("json() shares the in-flight raw fetch with load()", async () => {
    const { repo, cache } = setup();
    const v = repo.inject("a.excalidraw", scene(["r1"]));
    const [json] = await Promise.all([
      cache.json(v.id),
      cache.load(v.id, { images: false }),
    ]);
    expect(JSON.parse(json).elements).toHaveLength(1);
    expect(repo.calls.filter((c) => c === "readVersion")).toHaveLength(1);
  });

  it("clear() drops everything, including loaded images", async () => {
    const { repo, cache } = setup();
    repo.putBlob(`${SHA}.png`, new Uint8Array([1, 2, 3]));
    const v = repo.inject(
      "a.excalidraw",
      imageScene("f1", `data:image/png;base64,@vdblob:${SHA}.png`),
    );
    const loaded = await cache.load(v.id, { images: true });
    expect(loaded.files.f1.dataURL).toMatch(/^data:image\/png;base64,/);
    cache.clear();
    expect(cache.peek(v.id)).toBeUndefined();
    await cache.load(v.id, { images: false });
    expect(repo.calls.filter((c) => c === "readVersion")).toHaveLength(2);
  });

  it("a load that finishes after clear() is not cached", async () => {
    const { repo, cache } = setup();
    const v = repo.inject("a.excalidraw", scene(["r1"]));
    const pending = cache.load(v.id, { images: false });
    cache.clear();
    await pending;
    expect(cache.peek(v.id)).toBeUndefined();
  });

  describe("files", () => {
    it("resolves blob tokens through readBlob with the stored mime header", async () => {
      const { repo, cache } = setup();
      repo.putBlob(`${SHA}.png`, new Uint8Array([104, 105]));
      const v = repo.inject(
        "a.excalidraw",
        imageScene("f1", `data:image/png;base64,@vdblob:${SHA}.png`),
      );
      const loaded = await cache.load(v.id, { images: true });
      expect(loaded.imagesLoaded).toBe(true);
      expect(loaded.files.f1).toMatchObject({
        id: "f1",
        mimeType: "image/png",
        dataURL: `data:image/png;base64,${btoa("hi")}`,
      });
      expect(cache.peek(v.id)?.imagesLoaded).toBe(true);
    });

    it("never reads blobs unless images are requested", async () => {
      const { repo, cache } = setup();
      repo.putBlob(`${SHA}.png`, new Uint8Array([1]));
      const v = repo.inject(
        "a.excalidraw",
        imageScene("f1", `data:image/png;base64,@vdblob:${SHA}.png`),
      );
      const loaded = await cache.load(v.id, { images: false });
      expect(loaded.files).toEqual({});
      expect(repo.calls).not.toContain("readBlob");
    });

    it("prefers the main editor's files over blobs", async () => {
      const mainFile = {
        id: "f1",
        mimeType: "image/png",
        dataURL: "data:image/png;base64,MAIN",
        created: 5,
      };
      const { repo, cache } = setup(() => ({ f1: mainFile }));
      const v = repo.inject(
        "a.excalidraw",
        imageScene("f1", `data:image/png;base64,@vdblob:${SHA}.png`),
      );
      const loaded = await cache.load(v.id, { images: true });
      expect(loaded.files.f1).toBe(mainFile);
      expect(repo.calls).not.toContain("readBlob");
    });

    it("keeps inline (unstripped) data URLs as they are", async () => {
      const { repo, cache } = setup();
      const v = repo.inject(
        "a.excalidraw",
        imageScene("f1", "data:image/png;base64,QUJD"),
      );
      const loaded = await cache.load(v.id, { images: true });
      expect(loaded.files.f1.dataURL).toBe("data:image/png;base64,QUJD");
      expect(repo.calls).not.toContain("readBlob");
    });

    it("loads images once for a version already parsed without them", async () => {
      const { repo, cache } = setup();
      repo.putBlob(`${SHA}.png`, new Uint8Array([1]));
      const v = repo.inject(
        "a.excalidraw",
        imageScene("f1", `data:image/png;base64,@vdblob:${SHA}.png`),
      );
      await cache.load(v.id, { images: false });
      await cache.load(v.id, { images: true });
      await cache.load(v.id, { images: true });
      expect(repo.calls.filter((c) => c === "readVersion")).toHaveLength(1);
      expect(repo.calls.filter((c) => c === "readBlob")).toHaveLength(1);
    });
  });

  describe("abort", () => {
    it("rejects with AbortError and leaves the cache usable", async () => {
      const { repo, cache } = setup();
      const v = repo.inject("a.excalidraw", scene(["r1"]));
      const ctrl = new AbortController();
      const pending = cache.load(v.id, { images: false, signal: ctrl.signal });
      ctrl.abort();
      await expect(pending).rejects.toMatchObject({ name: "AbortError" });
      await expect(cache.load(v.id, { images: false })).resolves.toBeTruthy();
    });

    it("rejects immediately for an already aborted signal", async () => {
      const { repo, cache } = setup();
      const v = repo.inject("a.excalidraw", scene(["r1"]));
      const ctrl = new AbortController();
      ctrl.abort();
      const spy = vi.spyOn(repo, "readVersion");
      await expect(
        cache.load(v.id, { images: false, signal: ctrl.signal }),
      ).rejects.toMatchObject({ name: "AbortError" });
      expect(spy).not.toHaveBeenCalled();
    });
  });

  it("reports unreadable JSON as VERSION_CORRUPT", async () => {
    const { repo, cache } = setup();
    const v = repo.inject("a.excalidraw", "not json");
    await expect(cache.load(v.id, { images: false })).rejects.toMatchObject({
      code: "VERSION_CORRUPT",
    });
  });
});
