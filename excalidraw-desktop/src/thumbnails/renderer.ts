/**
 * Keyed, LRU-cached SVG thumbnail renderer on top of the shared job queue
 * (history rows, link hover cards, templates). Results are data-URL strings.
 */
import { createJobQueue } from "./queue";
import { renderSceneToSvgDataUrl } from "./render";

import type { RenderSvg } from "./render";

export interface ThumbnailRenderer {
  request(key: string, loadJson: () => Promise<string>): Promise<string | null>;
  cancel(key: string): void;
  clear(): void;
}

/** Per renderer: SVG data URLs can be large, so the count cap alone is not enough. */
export const DEFAULT_MAX_BYTES = 8 * 1024 * 1024;

export const createThumbnailRenderer = (
  opts: { renderSvg?: RenderSvg; maxCache?: number; maxBytes?: number } = {},
): ThumbnailRenderer => {
  const renderSvg = opts.renderSvg ?? renderSceneToSvgDataUrl;
  const maxCache = opts.maxCache ?? 300;
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  const cache = new Map<string, string | null>();
  let bytes = 0; // sum of cached string lengths
  const queue = createJobQueue();

  const forget = (key: string) => {
    bytes -= cache.get(key)?.length ?? 0;
    cache.delete(key);
  };

  /** Evicts least-recently-used entries past the count cap or the byte budget. */
  const remember = (key: string, value: string | null) => {
    forget(key);
    cache.set(key, value);
    bytes += value?.length ?? 0;
    // The newest entry always stays, even if it alone exceeds the byte budget.
    while (cache.size > 1 && (cache.size > maxCache || bytes > maxBytes)) {
      forget(cache.keys().next().value as string);
    }
  };

  return {
    request(key, loadJson) {
      if (cache.has(key)) {
        const v = cache.get(key)!;
        remember(key, v);
        return Promise.resolve(v);
      }
      // Cached inside the job: a cancelled job never runs, so is not cached.
      return queue.add(key, async () => {
        let result: string | null = null;
        try {
          result = await renderSvg(await loadJson());
        } catch {
          result = null;
        }
        remember(key, result);
        return result;
      });
    },
    cancel: (key) => queue.cancel(key),
    clear: () => {
      cache.clear();
      bytes = 0;
    },
  };
};
