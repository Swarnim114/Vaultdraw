import { describe, expect, it } from "vitest";

import { buildPdf } from "./pdfWriter";

const jpegOf = (n: number) =>
  new Uint8Array([0xff, 0xd8, ...Array(n).fill(7), 0xff, 0xd9]);

const page = (widthPt: number, heightPt: number, n = 10) => ({
  widthPt,
  heightPt,
  jpeg: jpegOf(n),
  pixelWidth: 100,
  pixelHeight: 200,
});

// latin1 keeps one char per byte so string indexes equal byte offsets
const latin1 = (bytes: Uint8Array) => new TextDecoder("latin1").decode(bytes);

describe("buildPdf", () => {
  it("writes header, trailer and a page tree with the exact media boxes", () => {
    const pdf = latin1(buildPdf([page(595, 842), page(842, 595)]));
    expect(pdf.startsWith("%PDF-1.4\n")).toBe(true);
    expect(pdf.trimEnd().endsWith("%%EOF")).toBe(true);
    expect(pdf).toContain("/Type /Pages /Count 2");
    expect(pdf).toContain("/MediaBox [0 0 595 842]");
    expect(pdf).toContain("/MediaBox [0 0 842 595]");
    expect(pdf).toContain("/Producer (Vaultdraw)");
    expect(pdf).toContain("q 595 0 0 842 0 0 cm /Im0 Do Q");
    expect(pdf).toContain("/Filter /DCTDecode");
    expect(pdf).toContain("/ColorSpace /DeviceRGB");
    expect(pdf).toContain("/BitsPerComponent 8");
  });

  it("xref offsets point at their object and startxref at the table", () => {
    const bytes = buildPdf([page(100, 100, 33), page(50, 60, 5), page(1, 2)]);
    const pdf = latin1(bytes);
    const startxref = Number(/startxref\n(\d+)\n/.exec(pdf)![1]);
    expect(pdf.slice(startxref, startxref + 5)).toBe("xref\n");
    const lines = pdf.slice(startxref).split("\n");
    const [first, count] = lines[1].split(" ").map(Number);
    expect(first).toBe(0);
    expect(count).toBe(4 + 3 * 3);
    expect(lines[2]).toBe("0000000000 65535 f ");
    for (let id = 1; id < count; id++) {
      const entry = lines[2 + id];
      expect(entry).toMatch(/^\d{10} 00000 n $/);
      const offset = Number(entry.slice(0, 10));
      expect(pdf.slice(offset, offset + `${id} 0 obj`.length)).toBe(
        `${id} 0 obj`,
      );
    }
    expect(pdf).toContain(`/Size ${count}`);
  });

  it("embeds the JPEG bytes untouched with a matching /Length", () => {
    const jpeg = jpegOf(300);
    const bytes = buildPdf([{ ...page(10, 10), jpeg }]);
    const pdf = latin1(bytes);
    const at = pdf.indexOf("stream\n\xff\xd8") + "stream\n".length;
    expect(Array.from(bytes.slice(at, at + jpeg.length))).toEqual(
      Array.from(jpeg),
    );
    expect(pdf).toContain(`/Length ${jpeg.length} >>`);
  });

  it("rejects an empty page list", () => {
    expect(() => buildPdf([])).toThrow();
  });

  it("rounds fractional points to 3 decimals", () => {
    const pdf = latin1(buildPdf([page(595.27559055, 841.8897)]));
    expect(pdf).toContain("/MediaBox [0 0 595.276 841.89]");
  });
});
