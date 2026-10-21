/**
 * Renders the chosen PDF pages natively (one in flight), turns them into
 * locked image elements and commits them to the scene in ONE update (one
 * undo step). Nothing is committed when aborted. The native token is always
 * closed.
 */
import { CaptureUpdateAction } from "@excalidraw/excalidraw";
import { getDataURL } from "@excalidraw/excalidraw/data/blob";
import { isPageModeOn } from "@excalidraw/excalidraw/data/pageSetup";
import { newImageElement, syncInvalidIndices } from "@excalidraw/element";

import type {
  AppState,
  BinaryFileData,
  ExcalidrawImperativeAPI,
} from "@excalidraw/excalidraw/types";
import type { FileId } from "@excalidraw/element/types";

import {
  getPageSetupPatch,
  type PageSetupPatch,
} from "../page/pageSetupChange";

import {
  byteBudget,
  currentDrawingBytes,
  pageJsonCost,
  planImportSides,
} from "./budget";
import { planPdfPlacement } from "./layout";
import { PdfImportAborted } from "./types";

import type {
  PdfBridge,
  PdfImportProgress,
  PdfImportResult,
  PdfImportSettings,
  PdfInfo,
} from "./types";

type ImportApi = Pick<
  ExcalidrawImperativeAPI,
  | "getAppState"
  | "getSceneElementsIncludingDeleted"
  | "getFiles"
  | "addFiles"
  | "updateScene"
>;

const MIN_QUALITY = 0.6;
/** Below this a page is unreadable whatever the budget. */
const MIN_RETRY_SIDE = 200;
const RETRY_MARGIN = 0.95;
/** Distance of the first page's top edge from the viewport top (screen px). */
const SCROLL_TOP_MARGIN = 24;

/** The native side may answer a JPEG request with a (gray) PNG when that is smaller. */
const mimeOf = (bytes: Uint8Array): BinaryFileData["mimeType"] =>
  bytes[0] === 0x89 &&
  bytes[1] === 0x50 &&
  bytes[2] === 0x4e &&
  bytes[3] === 0x47
    ? "image/png"
    : "image/jpeg";

const yieldToEventLoop = () =>
  new Promise<void>((resolve) => setTimeout(resolve, 0));

const sha1Hex = async (bytes: Uint8Array): Promise<FileId> => {
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-1",
    bytes as BufferSource,
  );
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("") as FileId;
};

const isPageFailed = (err: unknown) =>
  (err as { code?: unknown } | null)?.code === "PDF_PAGE_FAILED";

type Rendered = { index: number; fileId: FileId };

export const importPdf = async ({
  api,
  bridge,
  info,
  indices,
  settings,
  signal,
  onProgress,
}: {
  api: ImportApi;
  bridge: PdfBridge;
  info: PdfInfo;
  indices: readonly number[];
  settings: PdfImportSettings;
  signal?: AbortSignal;
  onProgress?: (progress: PdfImportProgress) => void;
}): Promise<PdfImportResult> => {
  try {
    const abortCheck = () => {
      if (signal?.aborted) {
        throw new PdfImportAborted();
      }
    };
    abortCheck();

    const elements = api.getSceneElementsIncludingDeleted();
    const appState = api.getAppState();
    const pageSetup = appState.pageSetup;
    const pageMode = isPageModeOn(pageSetup);

    // Page mode: never run past the page limit.
    const fit = planPdfPlacement({
      pages: info.pages,
      indices,
      elements,
      pageSetup,
    }).maxPagesThatFit;
    const wanted = indices.slice(0, fit);
    const clamped = indices.length - wanted.length;

    let side = planImportSides(info.pages, wanted, settings);
    const resultSide = side;
    let quality = settings.quality;
    let remaining = byteBudget(currentDrawingBytes(elements, api.getFiles()));

    const files = new Map<FileId, BinaryFileData>();
    const rendered: Rendered[] = [];
    const skipped: number[] = [];
    let truncated = clamped;

    const renderOnce = (index: number, maxSide: number, q: number) =>
      bridge.renderPage(info.token, index, {
        maxSide,
        format: settings.format,
        quality: q,
      });

    onProgress?.({ done: 0, total: wanted.length });
    for (let i = 0; i < wanted.length; i++) {
      abortCheck();
      const index = wanted[i];
      const pagesLeft = wanted.length - i;
      const target = remaining / pagesLeft;
      try {
        let bytes = await renderOnce(index, side, quality);
        abortCheck();
        let cost = pageJsonCost(bytes.length);
        if (cost > target) {
          const nextSide = Math.max(
            MIN_RETRY_SIDE,
            Math.floor(side * Math.sqrt(target / cost) * RETRY_MARGIN),
          );
          const nextQuality =
            settings.format === "jpeg"
              ? Math.max(MIN_QUALITY, quality - 0.1)
              : quality;
          if (target > 0 && nextSide < side) {
            bytes = await renderOnce(index, nextSide, nextQuality);
            abortCheck();
            cost = pageJsonCost(bytes.length);
            // later pages start from the reduced settings
            side = nextSide;
            quality = nextQuality;
          }
        }
        if (cost > remaining) {
          truncated += pagesLeft;
          break;
        }
        const dataURL = await getDataURL(
          new Blob([bytes as BlobPart], { type: mimeOf(bytes) }),
        );
        const id = await sha1Hex(bytes);
        abortCheck();
        if (!files.has(id)) {
          files.set(id, {
            id,
            mimeType: mimeOf(bytes),
            dataURL,
            created: Date.now(),
          });
        }
        remaining -= cost;
        rendered.push({ index, fileId: id });
      } catch (err) {
        if (err instanceof PdfImportAborted || !isPageFailed(err)) {
          throw err;
        }
        skipped.push(index);
      }
      onProgress?.({ done: i + 1, total: wanted.length });
      await yieldToEventLoop();
    }
    abortCheck();

    if (rendered.length === 0) {
      return { imported: 0, skipped, truncated, side: resultSide };
    }

    // Placement from what was actually rendered (no holes for skipped pages).
    const placement = planPdfPlacement({
      pages: info.pages,
      indices: rendered.map((r) => r.index),
      elements,
      pageSetup,
    });
    const created = rendered.map(({ index, fileId }, k) =>
      newImageElement({
        type: "image",
        ...placement.rects[k],
        fileId,
        status: "saved",
        scale: [1, 1],
        locked: settings.lockPages,
        customData: { pdfImport: { name: info.name, page: index + 1 } },
      }),
    );

    const next = [...elements, ...created];
    syncInvalidIndices(next);

    let patch: PageSetupPatch | Pick<AppState, "scrollX" | "scrollY">;
    if (pageMode && placement.pageCount !== undefined) {
      patch = getPageSetupPatch(appState, { pageCount: placement.pageCount });
    } else {
      // Normal mode: bring the first page into view (no zoom change).
      const zoom = appState.zoom.value;
      const first = placement.rects[0];
      patch = {
        scrollX: appState.width / (2 * zoom) - (first.x + first.width / 2),
        scrollY: SCROLL_TOP_MARGIN / zoom - first.y,
      };
    }

    api.addFiles([...files.values()]);
    api.updateScene({
      elements: next,
      // updateScene infers one Pick<AppState, K>; the patch is one of two
      appState: patch as Pick<AppState, "scrollX" | "scrollY">,
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
    return {
      imported: rendered.length,
      skipped,
      truncated,
      side: resultSide,
    };
  } finally {
    await bridge.close(info.token).catch(() => {});
  }
};
