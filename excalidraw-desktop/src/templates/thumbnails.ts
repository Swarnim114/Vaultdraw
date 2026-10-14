import { exportToSvg } from "@excalidraw/excalidraw";

import { withStandardCanvasColors } from "../editor/canvasSync";

export const THUMBNAIL_MAX_SIZE = 240;
export const THUMBNAIL_MAX_ELEMENTS = 2000;

export type RenderSvg = (json: string) => Promise<string | null>;

export interface ThumbnailRenderer {
  request(key: string, loadJson: () => Promise<string>): Promise<string | null>;
  cancel(key: string): void;
  clear(): void;
}

const toDataUrl = (svg: string) =>
  `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

/** Default renderer: scene JSON -> SVG data URL, or null (empty/invalid/huge). */
export const renderSceneToSvgDataUrl: RenderSvg = async (json) => {
  let data: any;
  try {
    data = JSON.parse(json);
  } catch {
    return null;
  }
  const elements = data?.elements;
  if (
    !Array.isArray(elements) ||
    elements.length === 0 ||
    elements.length > THUMBNAIL_MAX_ELEMENTS
  ) {
    return null;
  }
  const appState = {
    ...(data.appState ?? {}),
    exportBackground: true,
    exportEmbedScene: false,
  };
  return withStandardCanvasColors(async () => {
    const svg = await exportToSvg({
      elements,
      appState,
      files: data.files ?? {},
      exportPadding: 8,
      renderEmbeddables: false,
      skipInliningFonts: true,
    });
    const w = parseFloat(svg.getAttribute("width") || "0");
    const h = parseFloat(svg.getAttribute("height") || "0");
    if (w > 0 && h > 0) {
      const k = THUMBNAIL_MAX_SIZE / Math.max(w, h);
      svg.setAttribute("width", String(Math.round(w * k)));
      svg.setAttribute("height", String(Math.round(h * k)));
    }
    return toDataUrl(new XMLSerializer().serializeToString(svg));
  });
};

const yieldToEventLoop = (): Promise<void> =>
  new Promise((resolve) => {
    const ric = (globalThis as any).requestIdleCallback as
      | ((cb: () => void, opts?: { timeout: number }) => number)
      | undefined;
    if (typeof ric === "function") {
      ric(() => resolve(), { timeout: 50 });
    } else {
      setTimeout(resolve, 0);
    }
  });

type Job = {
  key: string;
  loadJson: () => Promise<string>;
  waiters: Array<(v: string | null) => void>;
  started: boolean;
};

export const createThumbnailRenderer = (
  opts: { renderSvg?: RenderSvg; maxCache?: number } = {},
): ThumbnailRenderer => {
  const renderSvg = opts.renderSvg ?? renderSceneToSvgDataUrl;
  const maxCache = opts.maxCache ?? 300;
  const cache = new Map<string, string | null>();
  const jobs = new Map<string, Job>();
  const queue: Job[] = [];
  let running = false;

  const remember = (key: string, value: string | null) => {
    cache.delete(key);
    cache.set(key, value);
    while (cache.size > maxCache) {
      cache.delete(cache.keys().next().value as string);
    }
  };

  const pump = async () => {
    if (running) {
      return;
    }
    running = true;
    try {
      while (queue.length > 0) {
        const job = queue.shift()!;
        job.started = true;
        let result: string | null = null;
        try {
          result = await renderSvg(await job.loadJson());
        } catch {
          result = null;
        }
        jobs.delete(job.key);
        remember(job.key, result);
        job.waiters.forEach((w) => w(result));
        if (queue.length > 0) {
          await yieldToEventLoop();
        }
      }
    } finally {
      running = false;
    }
  };

  return {
    request(key, loadJson) {
      if (cache.has(key)) {
        const v = cache.get(key)!;
        remember(key, v);
        return Promise.resolve(v);
      }
      const existing = jobs.get(key);
      if (existing) {
        return new Promise((resolve) => existing.waiters.push(resolve));
      }
      return new Promise((resolve) => {
        const job: Job = { key, loadJson, waiters: [resolve], started: false };
        jobs.set(key, job);
        queue.push(job);
        void pump();
      });
    },
    cancel(key) {
      const job = jobs.get(key);
      if (!job || job.started) {
        return;
      }
      queue.splice(queue.indexOf(job), 1);
      jobs.delete(key);
      job.waiters.forEach((w) => w(null));
    },
    clear() {
      cache.clear();
    },
  };
};
