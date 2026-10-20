/**
 * "Import file…": pick PDFs/images, then reuse the existing pipelines: the PDF
 * import dialog for a PDF, the editor's own image insertion for images (at the
 * right-clicked point, or the viewport centre from the palette).
 */
import { useCallback, useRef } from "react";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { IMPORT_ACCEPT, planImport, skippedMessage } from "./importFiles";
import { pickFiles } from "./pickFiles";

export type ScenePoint = { x: number; y: number };

export interface CanvasImportOptions {
  getApi: () => ExcalidrawImperativeAPI | undefined;
  getDocument: () => Document;
  openPdf: (file: File) => void | Promise<void>;
  notify: (message: string) => void;
  /** Injected in tests. */
  pick?: (doc: Document, accept: string) => Promise<File[]>;
}

export const importPickedFiles = async (
  files: readonly File[],
  at: ScenePoint | undefined,
  options: Pick<CanvasImportOptions, "getApi" | "openPdf" | "notify">,
) => {
  const api = options.getApi();
  if (!api || !files.length) {
    return;
  }
  const plan = planImport(files);
  const skipped = skippedMessage(plan.skipped);
  if (skipped) {
    options.notify(skipped);
  }
  if (plan.images.length) {
    await api.insertImages(plan.images, at);
  }
  if (plan.pdf) {
    await options.openPdf(plan.pdf);
  }
};

/** Stable `importFile(at?)`; nothing runs until it is called. */
export const useCanvasImport = (options: CanvasImportOptions) => {
  const live = useRef(options);
  live.current = options;
  return useCallback(async (at?: ScenePoint) => {
    const { getApi, getDocument, pick = pickFiles } = live.current;
    if (!getApi()) {
      return;
    }
    const files = await pick(getDocument(), IMPORT_ACCEPT);
    await importPickedFiles(files, at, live.current);
  }, []);
};
