/**
 * Scene -> PDF bytes. Each page is drawn by the editor's own exporter (same
 * fonts, rough style, images and paper pattern as the screen) into a canvas
 * restricted to the page rectangle by a synthetic frame, encoded as JPEG,
 * and the canvas is released before the next page. The event loop gets a
 * turn between pages, so the UI stays responsive on long documents.
 *
 * Callers wrap this in `withStandardCanvasColors` (exports never use the
 * theme's on-screen colours).
 */

import { getNonDeletedElements } from "@excalidraw/element";
import {
  createPageExportFrame,
  detachFromFrames,
} from "@excalidraw/excalidraw/data/pageExportFrame";
import {
  restoreAppState,
  restoreElements,
} from "@excalidraw/excalidraw/data/restore";
import { exportToCanvas } from "@excalidraw/excalidraw/scene/export";

import type { AppState, BinaryFiles } from "@excalidraw/excalidraw/types";

import type { ExcalidrawElement } from "@excalidraw/element/types";

import { buildPdf } from "./pdfWriter";
import { clampRenderScale, planPdfPages } from "./pdfPages";

import type { PdfPagePlan } from "./pdfPages";
import type { PdfPage } from "./pdfWriter";

export const PDF_JPEG_QUALITY = 0.9;
export const PDF_DEFAULT_SCALE = 2;

export type RenderPdfInput = {
  elements: readonly ExcalidrawElement[];
  appState: Partial<AppState>;
  files: BinaryFiles | null;
  /** Render scale (canvas px per scene px), 1 to 3. Default 2. */
  scale?: number;
  /** Paper pattern like the PNG export option. Default: appState's. */
  pattern?: boolean;
  onProgress?: (done: number, total: number) => void;
  signal?: AbortSignal;
};

/** Seams for tests (jsdom has no canvas). */
export type RenderPdfDeps = {
  drawPage: (
    plan: PdfPagePlan,
    scale: number,
  ) => Promise<{ jpeg: Uint8Array; pixelWidth: number; pixelHeight: number }>;
  yieldToEventLoop: () => Promise<void>;
};

const yieldToEventLoop = () =>
  new Promise<void>((resolve) => setTimeout(resolve, 0));

export class PdfExportAborted extends Error {
  constructor() {
    super("PDF export cancelled");
    this.name = "AbortError";
  }
}

const canvasToJpeg = (canvas: HTMLCanvasElement): Promise<Uint8Array> =>
  new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("Could not encode a page (canvas too large?)"));
          return;
        }
        blob
          .arrayBuffer()
          .then((buffer) => resolve(new Uint8Array(buffer)), reject);
      },
      "image/jpeg",
      PDF_JPEG_QUALITY,
    );
  });

export const renderPdf = async (
  input: RenderPdfInput,
  deps: Partial<RenderPdfDeps> = {},
): Promise<Uint8Array> => {
  const { signal, onProgress } = input;
  const scale = Math.min(3, Math.max(1, input.scale ?? PDF_DEFAULT_SCALE));
  const restoredAppState = restoreAppState(
    {
      ...input.appState,
      // JPEG has no alpha: pages are always filled with the page colour.
      exportBackground: true,
      exportBackgroundPattern:
        input.pattern ?? input.appState.exportBackgroundPattern ?? true,
      exportWithDarkMode: false,
    },
    null,
  );
  const appState = {
    ...restoredAppState,
    offsetTop: 0,
    offsetLeft: 0,
    width: 0,
    height: 0,
  };
  const plans = planPdfPages(appState.pageSetup, input.elements);
  // Restored once for all pages (not per page).
  const elements = detachFromFrames(
    getNonDeletedElements(
      restoreElements(input.elements, null, { deleteInvisibleElements: true }),
    ),
  );

  const drawPage =
    deps.drawPage ??
    (async (plan: PdfPagePlan, pageScale: number) => {
      const frame = createPageExportFrame(plan.rect);
      const effective = clampRenderScale(
        plan.rect.width,
        plan.rect.height,
        pageScale,
      );
      const canvas = await exportToCanvas(
        elements,
        { ...appState, exportScale: effective },
        input.files || {},
        {
          exportBackground: true,
          viewBackgroundColor: appState.viewBackgroundColor,
          exportingFrame: frame,
        },
        (width, height) => {
          const target = document.createElement("canvas");
          target.width = Math.round(width * effective);
          target.height = Math.round(height * effective);
          return { canvas: target, scale: effective };
        },
      );
      try {
        return {
          jpeg: await canvasToJpeg(canvas),
          pixelWidth: canvas.width,
          pixelHeight: canvas.height,
        };
      } finally {
        canvas.width = 0;
        canvas.height = 0;
      }
    });
  const yieldNow = deps.yieldToEventLoop ?? yieldToEventLoop;

  const pages: PdfPage[] = [];
  onProgress?.(0, plans.length);
  for (const plan of plans) {
    if (signal?.aborted) {
      throw new PdfExportAborted();
    }
    const drawn = await drawPage(plan, scale);
    pages.push({ widthPt: plan.widthPt, heightPt: plan.heightPt, ...drawn });
    onProgress?.(pages.length, plans.length);
    await yieldNow();
  }
  if (signal?.aborted) {
    throw new PdfExportAborted();
  }
  return buildPdf(pages);
};
