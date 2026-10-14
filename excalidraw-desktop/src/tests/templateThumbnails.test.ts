import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createThumbnailRenderer } from "../templates/thumbnails";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const flush = () => vi.advanceTimersByTimeAsync(10);

describe("createThumbnailRenderer", () => {
  it("caches results and dedupes in-flight requests", async () => {
    const renderSvg = vi.fn(async (j: string) => `url:${j}`);
    const r = createThumbnailRenderer({ renderSvg });
    const load = vi.fn(async () => "a");
    const p1 = r.request("k", load);
    const p2 = r.request("k", load);
    await flush();
    expect(await p1).toBe("url:a");
    expect(await p2).toBe("url:a");
    expect(renderSvg).toHaveBeenCalledTimes(1);
    expect(await r.request("k", load)).toBe("url:a");
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("runs one job at a time, in order, yielding between jobs", async () => {
    const order: string[] = [];
    const renderSvg = vi.fn(async (j: string) => {
      order.push(`render:${j}`);
      return j;
    });
    const r = createThumbnailRenderer({ renderSvg });
    const ps = ["a", "b", "c"].map((k) => r.request(k, async () => k));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(renderSvg.mock.calls.length).toBeLessThan(3);
    await flush();
    await Promise.all(ps);
    expect(order).toEqual(["render:a", "render:b", "render:c"]);
  });

  it("cancels queued jobs but not started ones", async () => {
    const renderSvg = vi.fn(async (j: string) => j);
    const r = createThumbnailRenderer({ renderSvg });
    const a = r.request("a", async () => "a");
    const b = r.request("b", async () => "b");
    r.cancel("b");
    r.cancel("a"); // already started
    await flush();
    expect(await a).toBe("a");
    expect(await b).toBeNull();
    expect(renderSvg).toHaveBeenCalledTimes(1);
    // cancelled entries are not cached
    const b2 = r.request("b", async () => "b");
    await flush();
    expect(await b2).toBe("b");
  });

  it("returns null on loader/renderer failure and for invalid JSON (default renderer)", async () => {
    const r = createThumbnailRenderer({
      renderSvg: async () => {
        throw new Error("x");
      },
    });
    const p = r.request("k", async () => "{}");
    await flush();
    expect(await p).toBeNull();

    const d = createThumbnailRenderer();
    const p2 = d.request("bad", async () => "not json");
    const p3 = d.request("empty", async () => '{"elements":[]}');
    await flush();
    expect(await p2).toBeNull();
    expect(await p3).toBeNull();
  });

  it("evicts least recently used entries", async () => {
    const renderSvg = vi.fn(async (j: string) => j);
    const r = createThumbnailRenderer({ renderSvg, maxCache: 2 });
    for (const k of ["a", "b", "a", "c"]) {
      const p = r.request(k, async () => k);
      await flush();
      await p;
    }
    expect(renderSvg).toHaveBeenCalledTimes(3);
    const p = r.request("b", async () => "b"); // evicted
    await flush();
    await p;
    expect(renderSvg).toHaveBeenCalledTimes(4);
  });
});
