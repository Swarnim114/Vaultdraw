/**
 * "Import file…" (canvas right-click, palette): which picked files go where.
 * PDFs go to the PDF import flow (page-range dialog), images are inserted like
 * a drop. Pure, so the routing is unit-tested without a picker or an editor.
 */
import { IMAGE_MIME_TYPES } from "@excalidraw/common";

const PDF_MIME = "application/pdf";

export const isPdfFile = (file: File) =>
  file.type === PDF_MIME || /\.pdf$/i.test(file.name);

const IMAGE_TYPES = new Set<string>(Object.values(IMAGE_MIME_TYPES));

export const isImportableImage = (file: File) => IMAGE_TYPES.has(file.type);

/** The picker's `accept`: PDF plus every image type the editor inserts. */
export const IMPORT_ACCEPT = [
  PDF_MIME,
  ".pdf",
  ...Object.values(IMAGE_MIME_TYPES),
  ...Object.keys(IMAGE_MIME_TYPES).map((ext) => `.${ext}`),
].join(",");

export interface ImportPlan {
  /** The first PDF (the dialog imports one document at a time). */
  pdf: File | null;
  images: File[];
  /** Everything else, including further PDFs. */
  skipped: File[];
}

export const planImport = (files: readonly File[]): ImportPlan => {
  const plan: ImportPlan = { pdf: null, images: [], skipped: [] };
  for (const file of files) {
    if (isPdfFile(file)) {
      if (plan.pdf) {
        plan.skipped.push(file);
      } else {
        plan.pdf = file;
      }
    } else if (isImportableImage(file)) {
      plan.images.push(file);
    } else {
      plan.skipped.push(file);
    }
  }
  return plan;
};

export const skippedMessage = (skipped: readonly File[]): string | null => {
  if (!skipped.length) {
    return null;
  }
  const names = skipped.map((f) => f.name).join(", ");
  return `Not imported: ${names}. Vaultdraw imports one PDF at a time and PNG, JPEG, SVG, GIF or WebP images.`;
};
