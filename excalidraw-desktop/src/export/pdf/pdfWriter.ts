/**
 * Minimal dependency-free PDF writer: one JPEG image per page.
 *
 * Object layout (ids are fixed, so offsets are known while writing):
 *   1 Catalog, 2 Pages, 3 Info, then per page i (0-based) three objects:
 *   4 + 3i Page, 5 + 3i content stream (`q W 0 0 H 0 0 cm /Im0 Do Q`),
 *   6 + 3i image XObject (/DCTDecode, DeviceRGB, 8 bits; the JPEG bytes are
 *   embedded as is, never re-encoded). The cross-reference table is written
 *   last. The JPEG chunks are only referenced (not copied) until the single
 *   concatenation at the end.
 */

export type PdfPage = {
  /** page size in PDF points (1/72 in) */
  widthPt: number;
  heightPt: number;
  /** a complete baseline/progressive RGB JPEG file */
  jpeg: Uint8Array;
  pixelWidth: number;
  pixelHeight: number;
};

const encoder = new TextEncoder();

/** Numbers in PDF content: no exponent, at most 3 decimals. */
const num = (n: number) => {
  if (!Number.isFinite(n)) {
    throw new Error("Invalid PDF number");
  }
  return String(Math.round(n * 1000) / 1000);
};

const pad10 = (n: number) => String(n).padStart(10, "0");

const FIRST_PAGE_OBJECT = 4;
const pageObjectId = (index: number) => FIRST_PAGE_OBJECT + index * 3;

export const buildPdf = (pages: readonly PdfPage[]): Uint8Array => {
  if (pages.length === 0) {
    throw new Error("A PDF needs at least one page");
  }
  const chunks: Uint8Array[] = [];
  const offsets: number[] = []; // offsets[id] = byte offset of "id 0 obj"
  let length = 0;
  const push = (chunk: Uint8Array) => {
    chunks.push(chunk);
    length += chunk.length;
  };
  const text = (value: string) => push(encoder.encode(value));
  const beginObject = (id: number) => {
    offsets[id] = length;
    text(`${id} 0 obj\n`);
  };
  const endObject = () => text("endobj\n");

  // Header; the binary comment makes tools treat the file as binary.
  text("%PDF-1.4\n");
  push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));

  beginObject(1);
  text("<< /Type /Catalog /Pages 2 0 R >>\n");
  endObject();

  beginObject(2);
  const kids = pages.map((_, i) => `${pageObjectId(i)} 0 R`).join(" ");
  text(`<< /Type /Pages /Count ${pages.length} /Kids [${kids}] >>\n`);
  endObject();

  beginObject(3);
  text("<< /Producer (Vaultdraw) >>\n");
  endObject();

  pages.forEach((page, i) => {
    const pageId = pageObjectId(i);
    const w = num(page.widthPt);
    const h = num(page.heightPt);

    beginObject(pageId);
    text(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] ` +
        `/Resources << /XObject << /Im0 ${pageId + 2} 0 R >> >> ` +
        `/Contents ${pageId + 1} 0 R >>\n`,
    );
    endObject();

    const content = `q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q\n`;
    beginObject(pageId + 1);
    text(`<< /Length ${content.length} >>\nstream\n${content}endstream\n`);
    endObject();

    beginObject(pageId + 2);
    text(
      `<< /Type /XObject /Subtype /Image /Width ${page.pixelWidth} ` +
        `/Height ${page.pixelHeight} /ColorSpace /DeviceRGB ` +
        `/BitsPerComponent 8 /Filter /DCTDecode /Length ${page.jpeg.length} >>\nstream\n`,
    );
    push(page.jpeg);
    text("\nendstream\n");
    endObject();
  });

  const objectCount = FIRST_PAGE_OBJECT + pages.length * 3; // incl. object 0
  const xrefOffset = length;
  let xref = `xref\n0 ${objectCount}\n0000000000 65535 f \n`;
  for (let id = 1; id < objectCount; id++) {
    xref += `${pad10(offsets[id])} 00000 n \n`;
  }
  text(xref);
  text(
    `trailer\n<< /Size ${objectCount} /Root 1 0 R /Info 3 0 R >>\n` +
      `startxref\n${xrefOffset}\n%%EOF\n`,
  );

  const out = new Uint8Array(length);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
};
