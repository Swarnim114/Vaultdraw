/**
 * Thumbnails for the preview card: a small read cache (a hover reads a file
 * at most once per few seconds) in front of the shared thumbnail renderer
 * (serialised jobs, idle yields, LRU) keyed by `path@revision`.
 */
import { createThumbnailRenderer } from "../../../templates/thumbnails";

import type { RenderSvg } from "../../../templates/thumbnails";

export type ReadDrawing = (
  path: string,
) => Promise<{ json: string; revision: string }>;

export const READ_TTL_MS = 5000;
export const THUMB_CACHE = 32;

export interface PreviewThumbnails {
  get(path: string, read: ReadDrawing): Promise<string | null>;
  clear(): void;
}

export function createPreviewThumbnails(
  opts: { renderSvg?: RenderSvg; now?: () => number } = {},
): PreviewThumbnails {
  const renderer = createThumbnailRenderer({
    renderSvg: opts.renderSvg,
    maxCache: THUMB_CACHE,
  });
  const now = opts.now ?? Date.now;
  // path -> the last read (in flight) or, once rendered, just its revision:
  // the JSON itself is never kept after the render.
  const reads = new Map<
    string,
    {
      at: number;
      revision?: string;
      p?: Promise<{ json: string; revision: string }>;
    }
  >();
  const remember = (path: string, entry: Parameters<typeof reads.set>[1]) => {
    reads.delete(path);
    reads.set(path, entry);
    if (reads.size > 16) {
      reads.delete(reads.keys().next().value as string);
    }
  };
  return {
    async get(path, read) {
      const t = now();
      const hit = reads.get(path);
      if (hit?.revision && t - hit.at <= READ_TTL_MS) {
        const key = `${path}@${hit.revision}`;
        return renderer.request(key, async () => (await read(path)).json);
      }
      const p = hit?.p && t - hit.at <= READ_TTL_MS ? hit.p : read(path);
      remember(path, { at: hit?.p === p ? hit.at : t, p });
      try {
        const { json, revision } = await p;
        const url = await renderer.request(
          `${path}@${revision}`,
          async () => json,
        );
        if (reads.get(path)?.p === p) {
          remember(path, { at: reads.get(path)!.at, revision });
        }
        return url;
      } catch {
        reads.delete(path);
        return null;
      }
    },
    clear() {
      reads.clear();
      renderer.clear();
    },
  };
}
