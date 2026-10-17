/**
 * PDF import: shared contract between the native bridge (Rust, see
 * src-tauri/src/pdf_import.rs), the importer core and the UI.
 */

/** Page size in PDF points (CropBox after /Rotate, display orientation). */
export type PdfPageInfo = { widthPt: number; heightPt: number };

export type PdfInfo = {
  /** Handle of the open document on the native side; close it when done. */
  token: number;
  name: string;
  pageCount: number;
  pages: PdfPageInfo[];
  byteSize: number;
};

export type PdfImageFormat = "jpeg" | "png";

export type PdfRenderOptions = {
  /** Longest side of the rendered bitmap in pixels. */
  maxSide: number;
  format: PdfImageFormat;
  /** JPEG quality 0..1 (ignored for PNG). */
  quality: number;
};

export interface PdfBridge {
  /** Native open dialog; null when the user cancels. */
  pick(): Promise<PdfInfo | null>;
  /** Opens a PDF from bytes (e.g. a file dropped on the canvas). */
  openBytes(name: string, bytes: Uint8Array): Promise<PdfInfo>;
  /** Renders one page (0-based) to encoded image bytes. */
  renderPage(
    token: number,
    index: number,
    opts: PdfRenderOptions,
  ): Promise<Uint8Array>;
  close(token: number): Promise<void>;
}

export type PdfImportSettings = {
  /** Upper bound for the rendered long side, in pixels. */
  maxSide: number;
  format: PdfImageFormat;
  quality: number;
  /** Imported pages are locked so annotating doesn't drag them. */
  lockPages: boolean;
  /** Show a size/memory warning above this many pages. */
  warnPages: number;
  /** Decoded-pixel budget per import, in megapixels (adapts the resolution). */
  pixelBudgetMp: number;
};

export const DEFAULT_PDF_IMPORT_SETTINGS: PdfImportSettings = {
  maxSide: 1440,
  format: "jpeg",
  quality: 0.85,
  lockPages: true,
  warnPages: 50,
  pixelBudgetMp: 60,
};

export const PDF_IMPORT_LIMITS = {
  maxSide: { min: 600, max: 3000 },
  quality: { min: 0.5, max: 1 },
  warnPages: { min: 1, max: 500 },
  pixelBudgetMp: { min: 10, max: 400 },
  /** Never render below this long side, whatever the budgets say. */
  minSide: 800,
  /** Pages per import (page mode itself allows at most 500 pages). */
  maxPages: 200,
} as const;

/** Mirrors the native MAX_DRAWING_BYTES (src-tauri/src/lib.rs). */
export const MAX_DRAWING_BYTES = 32 * 1024 * 1024;
/** Share of MAX_DRAWING_BYTES an import may fill (headroom for annotations). */
export const DRAWING_BYTES_HEADROOM = 0.9;

/** Error codes from the native side (NativeError.code). */
export type PdfErrorCode =
  | "PDF_ENCRYPTED"
  | "PDF_INVALID"
  | "PDF_PAGE_FAILED"
  | "PDF_BAD_TOKEN"
  | "PDF_TOO_LARGE";

export class PdfImportAborted extends Error {
  constructor() {
    super("PDF import cancelled");
    this.name = "PdfImportAborted";
  }
}

export type PdfImportProgress = { done: number; total: number };

export type PdfImportResult = {
  /** Number of pages placed in the drawing. */
  imported: number;
  /** 0-based PDF page indices that failed to render. */
  skipped: number[];
  /** Pages not imported because the drawing reached its size limit. */
  truncated: number;
  /** Effective long side used (after budgets), for the notice. */
  side: number;
};
