import { describe, expect, it, vi } from "vitest";

import { createPreviewThumbnails } from "./previewThumbnails";

describe("previewThumbnails", () => {
  it("reads once per TTL and renders once per path@revision", async () => {
    let t = 0;
    const renderSvg = vi.fn(async (json: string) => `svg:${json}`);
    const thumbs = createPreviewThumbnails({ renderSvg, now: () => t });
    const read = vi.fn(async (p: string) => ({ json: p, revision: "r1" }));

    expect(await thumbs.get("a.excalidraw", read)).toBe("svg:a.excalidraw");
    expect(await thumbs.get("a.excalidraw", read)).toBe("svg:a.excalidraw");
    expect(read).toHaveBeenCalledTimes(1);
    expect(renderSvg).toHaveBeenCalledTimes(1);

    // TTL expired, same revision: re-read, no re-render.
    t = 10_000;
    await thumbs.get("a.excalidraw", read);
    expect(read).toHaveBeenCalledTimes(2);
    expect(renderSvg).toHaveBeenCalledTimes(1);

    // New revision: render again.
    t = 20_000;
    read.mockResolvedValueOnce({ json: "new", revision: "r2" });
    expect(await thumbs.get("a.excalidraw", read)).toBe("svg:new");
    expect(renderSvg).toHaveBeenCalledTimes(2);
  });

  it("returns null when reading fails", async () => {
    const thumbs = createPreviewThumbnails({ renderSvg: async () => "x" });
    expect(
      await thumbs.get("a", async () => {
        throw new Error("io");
      }),
    ).toBeNull();
  });
});
