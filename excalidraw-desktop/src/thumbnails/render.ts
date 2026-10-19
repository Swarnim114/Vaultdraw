/**
 * The one scene -> image renderer behind every thumbnail: scene parse + caps,
 * standard colours, and two outputs (SVG data URL for in-memory snapshots, PNG
 * blob for the disk cache). `@excalidraw/excalidraw` is only imported
 * dynamically, when the first job runs.
 */
import { withStandardColors } from "./standardColors";

/** Bump when the renderer's output changes (retries fail markers, replaces PNGs). */
export const RENDER_VERSION = 1;

// SVG data URLs (history rows, link cards, templates).
export const THUMBNAIL_MAX_SIZE = 240;
export const THUMBNAIL_MAX_ELEMENTS = 2000;

// PNG disk cache.
export const THUMB_PNG_EDGE = 384;
/**
 * Step 0 (2026-10-19, e2e/thumbnailsPerf.spec.ts): renderScenePng p95 at 4x CPU
 * throttle is 13 ms at 100, 42 ms at 500 and 95-106 ms at 1500 elements, so
 * the 50 ms long-task budget holds up to about 600 elements.
 */
export const THUMB_MAX_ELEMENTS = 600;
/** Above this the scene is not parsed at all (long task); fail marker. */
export const THUMB_MAX_JSON_BYTES = 8 * 1024 * 1024;
/** Above this the embedded images are dropped (placeholders): bounds decode cost. */
export const THUMB_FILES_JSON_BYTES = 4 * 1024 * 1024;

export type FailReason =
  | "invalid"
  | "empty"
  | "too-many"
  | "too-large"
  | "encode"
  | "error";
export type PngResult =
  | { kind: "png"; blob: Blob }
  | { kind: "fail"; reason: FailReason };

export type RenderSvg = (json: string) => Promise<string | null>;
export type RenderPng = (json: string) => Promise<PngResult>;

type Scene = { elements: any[]; appState: any; files: any };

const parseScene = (
  json: string,
  limits: {
    maxElements: number;
    maxJsonChars?: number;
    dropFilesAbove?: number;
  },
): Scene | FailReason => {
  if (limits.maxJsonChars !== undefined && json.length > limits.maxJsonChars) {
    return "too-large";
  }
  let data: any;
  try {
    data = JSON.parse(json);
  } catch {
    return "invalid";
  }
  const elements = data?.elements;
  if (!Array.isArray(elements)) {
    return "invalid";
  }
  if (elements.length === 0) {
    return "empty";
  }
  if (elements.length > limits.maxElements) {
    return "too-many";
  }
  const dropFiles =
    limits.dropFilesAbove !== undefined && json.length > limits.dropFilesAbove;
  return {
    elements,
    appState: {
      ...(data.appState ?? {}),
      exportBackground: true,
      exportEmbedScene: false,
    },
    files: dropFiles ? {} : data.files ?? {},
  };
};

const toDataUrl = (svg: string) =>
  `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

/** Scene JSON -> SVG data URL, or null (empty/invalid/huge). */
export const renderSceneToSvgDataUrl: RenderSvg = async (json) => {
  const scene = parseScene(json, { maxElements: THUMBNAIL_MAX_ELEMENTS });
  if (typeof scene === "string") {
    return null;
  }
  const { exportToSvg } = await import("@excalidraw/excalidraw");
  return withStandardColors(async () => {
    const svg = await exportToSvg({
      elements: scene.elements,
      appState: scene.appState,
      files: scene.files,
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

const canvasToPng = async (canvas: HTMLCanvasElement): Promise<Blob | null> => {
  try {
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/png"),
    );
    // WKWebView silently falls back to PNG for unsupported types; be explicit.
    return blob && blob.type === "image/png" ? blob : null;
  } finally {
    canvas.width = 0; // release the backing store (WebKit canvas memory cap)
  }
};

/** Scene JSON -> opaque PNG, long edge THUMB_PNG_EDGE, standard light colours. */
export const renderScenePng: RenderPng = async (json) => {
  const scene = parseScene(json, {
    maxElements: THUMB_MAX_ELEMENTS,
    maxJsonChars: THUMB_MAX_JSON_BYTES,
    dropFilesAbove: THUMB_FILES_JSON_BYTES,
  });
  if (typeof scene === "string") {
    return { kind: "fail", reason: scene };
  }
  try {
    const { exportToCanvas } = await import("@excalidraw/excalidraw");
    return await withStandardColors(async (): Promise<PngResult> => {
      const canvas = await exportToCanvas({
        elements: scene.elements,
        appState: {
          ...scene.appState,
          exportScale: 1,
          exportWithDarkMode: false,
        },
        files: scene.files,
        maxWidthOrHeight: THUMB_PNG_EDGE,
        exportPadding: 8,
      });
      const blob = await canvasToPng(canvas);
      return blob ? { kind: "png", blob } : { kind: "fail", reason: "encode" };
    });
  } catch {
    return { kind: "fail", reason: "error" };
  }
};
