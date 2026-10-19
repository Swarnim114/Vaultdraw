/**
 * Packaged-app smoke for the thumbnail disk cache and the vdthumb:// scheme.
 * Uses the app's own store (desktopStore) end to end: thumbs_lookup for the real
 * revision, thumbs_put of a known PNG, an <img> load through the scheme (decoded
 * size asserted), malformed URLs rejected, then thumbs_clear and a 404.
 */
import { createDesktopThumbnailStore } from "../thumbnails/desktopStore";

import type { LookupResult } from "../thumbnails/store";

export type ThumbnailsSmokeContext = {
  win: Window & typeof globalThis;
  doc: Document;
  handle: string;
  /** A drawing that exists in the smoke vault (vault-relative path). */
  drawingPath: string;
  step: <T>(name: string, work: () => Promise<T>) => Promise<T>;
};

const WIDTH = 7;
const HEIGHT = 5;
const RENDER_VERSION = 1;

export async function runThumbnailsSmoke(ctx: ThumbnailsSmokeContext) {
  const { win, doc, handle, drawingPath, step } = ctx;
  const store = createDesktopThumbnailStore();
  const now = () => win.performance.now();

  /** Resolves with the decoded size, or null when the load fails (404 / rejected). */
  const loadImage = (url: string) =>
    new Promise<{ w: number; h: number } | null>((resolve) => {
      const img = doc.createElement("img");
      const timer = win.setTimeout(() => resolve(null), 5000);
      img.onload = () => {
        win.clearTimeout(timer);
        resolve({ w: img.naturalWidth, h: img.naturalHeight });
      };
      img.onerror = () => {
        win.clearTimeout(timer);
        resolve(null);
      };
      img.src = url;
    });

  const makePng = () =>
    new Promise<Blob>((resolve, reject) => {
      const canvas = doc.createElement("canvas");
      canvas.width = WIDTH;
      canvas.height = HEIGHT;
      const g = canvas.getContext("2d");
      if (!g) {
        reject(new Error("no 2d context"));
        return;
      }
      g.fillStyle = "#ec5f67";
      g.fillRect(0, 0, WIDTH, HEIGHT);
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("toBlob failed"))),
        "image/png",
      );
    });

  await step("thumbnails-cache-and-vdthumb-scheme", async () => {
    const t0 = now();
    // A real revision: whatever the app currently derives for the fixture drawing.
    const first = await store.lookup(handle, [drawingPath], RENDER_VERSION);
    const rev = first.items[0]?.rev;
    if (!rev || first.items[0].state === "missing") {
      throw new Error(`lookup gave no revision: ${JSON.stringify(first)}`);
    }
    const { vaultId } = first;

    const png = await makePng();
    const tPut = now();
    const url = await store.put(handle, drawingPath, rev, png, RENDER_VERSION);
    const putMs = Math.round(now() - tPut);
    if (url !== store.urlFor(vaultId, rev)) {
      throw new Error(
        `put url ${url} != builder ${store.urlFor(vaultId, rev)}`,
      );
    }

    const second: LookupResult = await store.lookup(
      handle,
      [drawingPath],
      RENDER_VERSION,
    );
    if (second.items[0].state !== "hit" || second.items[0].rev !== rev) {
      throw new Error(`lookup after put: ${JSON.stringify(second.items[0])}`);
    }

    const tLoad = now();
    const size = await loadImage(url);
    const loadMs = Math.round(now() - tLoad);
    if (!size || size.w !== WIDTH || size.h !== HEIGHT) {
      throw new Error(`vdthumb load gave ${JSON.stringify(size)}`);
    }

    // Malformed paths are rejected by construction (hex-only names).
    const bad = [
      `vdthumb://localhost/${vaultId}/..%2F..%2Fconfig.png`,
      `vdthumb://localhost/${vaultId}/${"g".repeat(64)}.png`,
      `vdthumb://localhost/${vaultId}/${rev.slice(0, 63)}.png`,
      `vdthumb://localhost/${vaultId}/${rev.toUpperCase()}.png`,
      `vdthumb://localhost/${"z".repeat(16)}/${rev}.png`,
      `vdthumb://localhost/${vaultId}/${rev}.png/..`,
      `vdthumb://localhost/${vaultId}/${rev}.jpg`,
    ];
    const accepted: string[] = [];
    for (const u of bad) {
      if (await loadImage(u)) {
        accepted.push(u);
      }
    }
    if (accepted.length) {
      throw new Error(`malformed urls were served: ${accepted.join(", ")}`);
    }

    await store.clear(handle);
    const after = await loadImage(url);
    if (after) {
      throw new Error("vdthumb still served after thumbs_clear");
    }
    const third = await store.lookup(handle, [drawingPath], RENDER_VERSION);
    if (third.items[0].state === "hit") {
      throw new Error("lookup still reports a hit after thumbs_clear");
    }

    return {
      vaultId,
      rev: rev.slice(0, 12),
      decoded: `${size.w}x${size.h}`,
      putMs,
      loadMs,
      malformedRejected: bad.length,
      clearedGone: true,
      roundTripMs: Math.round(now() - t0),
    };
  });
}
