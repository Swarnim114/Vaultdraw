/** In-memory PdfBridge for vitest and the e2e harness. */
import type {
  PdfBridge,
  PdfImageFormat,
  PdfInfo,
  PdfPageInfo,
  PdfRenderOptions,
} from "../pdfImport/types";

export type FakePdfDoc = { name: string; pages: PdfPageInfo[] };

export type FakePdfBridgeOptions = {
  /** Page sizes (pt) of docs created by openBytes / the default nextPick. */
  pages?: PdfPageInfo[];
  /** Per-page render delay in ms. */
  delayMs?: number;
  /** 0-based page indices whose render fails with PDF_PAGE_FAILED. */
  failPages?: number[];
  /** Error code thrown by open/pick (e.g. PDF_ENCRYPTED). */
  openError?: string;
  /** jsdom fallback: encoded bytes per pixel (default 0.01). */
  bytesPerPx?: number;
};

export const A4_PT: PdfPageInfo = { widthPt: 595, heightPt: 842 };

export const makePages = (n: number, page: PdfPageInfo = A4_PT) =>
  Array.from({ length: n }, () => ({ ...page }));

const codeError = (code: string) =>
  Object.assign(new Error(`fake pdf error ${code}`), { code });

const hasCanvas = () => {
  try {
    const c = document.createElement("canvas");
    return typeof c.toBlob === "function" && c.getContext("2d") !== null;
  } catch {
    return false;
  }
};

export class FakePdfBridge implements PdfBridge {
  /** Result of the next pick(): a doc, or null for "cancelled". */
  nextPick: PdfInfo | null = null;
  delayMs: number;
  failPages: Set<number>;
  openError: string | null;
  defaultPages: PdfPageInfo[];
  bytesPerPx: number;

  readonly renders: {
    token: number;
    index: number;
    opts: PdfRenderOptions;
  }[] = [];
  readonly closes: number[] = [];
  readonly opened: number[] = [];

  private nextToken = 1;
  private docs = new Map<number, PdfInfo>();

  constructor(options: FakePdfBridgeOptions = {}) {
    this.defaultPages = options.pages ?? makePages(3);
    this.delayMs = options.delayMs ?? 0;
    this.failPages = new Set(options.failPages ?? []);
    this.openError = options.openError ?? null;
    this.bytesPerPx = options.bytesPerPx ?? 0.01;
  }

  /** Registers a doc and returns its info (usable as nextPick). */
  makeDoc(name: string, pages: PdfPageInfo[] = this.defaultPages): PdfInfo {
    const info: PdfInfo = {
      token: this.nextToken++,
      name,
      pageCount: pages.length,
      pages,
      byteSize: pages.length * 50_000,
    };
    this.docs.set(info.token, info);
    this.opened.push(info.token);
    return info;
  }

  pick = async (): Promise<PdfInfo | null> => {
    if (this.openError) {
      throw codeError(this.openError);
    }
    const next = this.nextPick;
    this.nextPick = null;
    if (!next) {
      return null;
    }
    this.docs.set(next.token, next);
    this.opened.push(next.token);
    return next;
  };

  openBytes = async (name: string, _bytes: Uint8Array): Promise<PdfInfo> => {
    if (this.openError) {
      throw codeError(this.openError);
    }
    return this.makeDoc(name);
  };

  renderPage = async (
    token: number,
    index: number,
    opts: PdfRenderOptions,
  ): Promise<Uint8Array> => {
    this.renders.push({ token, index, opts });
    const doc = this.docs.get(token);
    if (!doc || this.closes.includes(token)) {
      throw codeError("PDF_BAD_TOKEN");
    }
    if (this.delayMs) {
      await new Promise((r) => setTimeout(r, this.delayMs));
    }
    if (this.failPages.has(index)) {
      throw codeError("PDF_PAGE_FAILED");
    }
    const page = doc.pages[index];
    const long = Math.max(page.widthPt, page.heightPt);
    const w = Math.max(1, Math.round((page.widthPt / long) * opts.maxSide));
    const h = Math.max(1, Math.round((page.heightPt / long) * opts.maxSide));
    return hasCanvas()
      ? drawPage(w, h, index + 1, opts.format, opts.quality)
      : fallbackBytes(w, h, index, opts.format, this.bytesPerPx);
  };

  close = async (token: number): Promise<void> => {
    this.closes.push(token);
  };
}

const drawPage = (
  w: number,
  h: number,
  label: number,
  format: PdfImageFormat,
  quality: number,
): Promise<Uint8Array> => {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#000";
  ctx.font = `${Math.round(h / 4)}px sans-serif`;
  ctx.textAlign = "center";
  ctx.fillText(String(label), w / 2, h / 2);
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      async (blob) =>
        blob
          ? resolve(new Uint8Array(await blob.arrayBuffer()))
          : reject(new Error("toBlob failed")),
      format === "png" ? "image/png" : "image/jpeg",
      quality,
    ),
  );
};

/** jsdom: deterministic bytes whose length scales with the pixel count. */
const fallbackBytes = (
  w: number,
  h: number,
  index: number,
  format: PdfImageFormat,
  bytesPerPx: number,
): Uint8Array => {
  const length = Math.max(16, Math.floor(w * h * bytesPerPx));
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i++) {
    bytes[i] = (i * 31 + index * 7 + w) & 0xff;
  }
  bytes[0] = format === "png" ? 0x89 : 0xff;
  return bytes;
};
