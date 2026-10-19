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

export const createThumbnailRenderer = (
  opts: { renderSvg?: RenderSvg; maxCache?: number } = {},
): ThumbnailRenderer => {
  const renderSvg = opts.renderSvg ?? renderSceneToSvgDataUrl;
  const maxCache = opts.maxCache ?? 300;
  const cache = new Map<string, string | null>();
  const queue = createJobQueue();

  const remember = (key: string, value: string | null) => {
    cache.delete(key);
    cache.set(key, value);
    while (cache.size > maxCache) {
      cache.delete(cache.keys().next().value as string);
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
    clear: () => cache.clear(),
  };
};
