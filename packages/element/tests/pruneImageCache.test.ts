import { API } from "@excalidraw/excalidraw/tests/helpers/api";

import { pruneImageCache } from "../src/image";

import type { FileId } from "../src/types";

const fid = (n: number) => `f${n}` as FileId;
const img = (n: number, isDeleted = false) =>
  API.createElement({ type: "image", fileId: fid(n), isDeleted });

const makeCache = (n: number) =>
  new Map<FileId, unknown>(
    Array.from({ length: n }, (_, i) => [fid(i), { image: {} }]),
  );

describe("pruneImageCache", () => {
  it("skips small caches", () => {
    const cache = makeCache(3);
    const since = new Map<FileId, number>();
    expect(
      pruneImageCache({
        cache,
        elements: [],
        unreferencedSince: since,
        now: 0,
      }),
    ).toEqual({ removed: 0, pending: 0 });
    expect(cache.size).toBe(3);
  });

  it("keeps referenced, removes unreferenced only after the grace period", () => {
    const cache = makeCache(10);
    const since = new Map<FileId, number>();
    const elements = [img(0), img(1)];
    const run = (now: number) =>
      pruneImageCache({ cache, elements, unreferencedSince: since, now });
    expect(run(1000)).toEqual({ removed: 0, pending: 8 });
    expect(cache.size).toBe(10);
    expect(run(2000).removed).toBe(0);
    expect(run(3000)).toEqual({ removed: 8, pending: 0 });
    expect([...cache.keys()]).toEqual([fid(0), fid(1)]);
  });

  it("a young entry that gets referenced within the grace is kept", () => {
    const cache = makeCache(9);
    const since = new Map<FileId, number>();
    const elements = [img(0)];
    pruneImageCache({ cache, elements, unreferencedSince: since, now: 0 });
    elements.push(img(5)); // inserted element lands in the scene
    pruneImageCache({ cache, elements, unreferencedSince: since, now: 3000 });
    expect(cache.has(fid(5))).toBe(true);
    expect(since.has(fid(5))).toBe(false);
  });

  it("honours keep and treats deleted elements as unreferenced", () => {
    const cache = makeCache(10);
    const since = new Map<FileId, number>();
    const elements = [img(0, true), img(1)];
    const keep = new Set([fid(2)]);
    const run = (now: number) =>
      pruneImageCache({ cache, elements, unreferencedSince: since, now, keep });
    run(0);
    run(2500);
    expect(cache.has(fid(0))).toBe(false);
    expect(cache.has(fid(1))).toBe(true);
    expect(cache.has(fid(2))).toBe(true);
  });

  it("an undo-restored element is re-added by the editor, prune does not interfere", () => {
    const cache = makeCache(10);
    const since = new Map<FileId, number>();
    const run = (els: any[], now: number) =>
      pruneImageCache({ cache, elements: els, unreferencedSince: since, now });
    run([], 0);
    run([], 2500);
    expect(cache.size).toBe(0);
    // below minEntries nothing more happens and markers are reset
    cache.set(fid(1), {});
    expect(run([img(1)], 3000).removed).toBe(0);
    expect(cache.has(fid(1))).toBe(true);
  });
});
