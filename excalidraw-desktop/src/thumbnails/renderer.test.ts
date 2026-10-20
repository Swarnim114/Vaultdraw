import { describe, expect, it, vi } from "vitest";

import { createThumbnailRenderer } from "./renderer";

const setup = (opts: { maxCache?: number; maxBytes?: number }) => {
  const renderSvg = vi.fn(async (json: string) => json);
  const r = createThumbnailRenderer({ renderSvg, ...opts });
  const get = (key: string, size: number) =>
    r.request(key, async () => "x".repeat(size));
  return { renderSvg, r, get };
};

describe("createThumbnailRenderer cache", () => {
  it("evicts least-recently-used entries past the byte budget", async () => {
    const { renderSvg, get } = setup({ maxBytes: 100 });
    await get("a", 40);
    await get("b", 40);
    await get("a", 40); // a is now most recent
    await get("c", 40); // 120 > 100: evicts b
    expect(renderSvg).toHaveBeenCalledTimes(3);
    await get("a", 40);
    await get("c", 40);
    expect(renderSvg).toHaveBeenCalledTimes(3);
    await get("b", 40);
    expect(renderSvg).toHaveBeenCalledTimes(4);
  });

  it("keeps a single oversized entry", async () => {
    const { renderSvg, get } = setup({ maxBytes: 10 });
    await get("big", 50);
    await get("big", 50);
    expect(renderSvg).toHaveBeenCalledTimes(1);
  });

  it("still honours the count cap", async () => {
    const { renderSvg, get } = setup({ maxCache: 2, maxBytes: 1e9 });
    await get("a", 1);
    await get("b", 1);
    await get("c", 1);
    await get("a", 1);
    expect(renderSvg).toHaveBeenCalledTimes(4);
  });

  it("resets the byte count on clear", async () => {
    const { renderSvg, r, get } = setup({ maxBytes: 100 });
    await get("a", 60);
    r.clear();
    await get("b", 60);
    await get("b", 60);
    expect(renderSvg).toHaveBeenCalledTimes(2);
  });
});
