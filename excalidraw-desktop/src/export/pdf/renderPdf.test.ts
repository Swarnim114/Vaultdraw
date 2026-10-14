import { updatePageSetup } from "@excalidraw/excalidraw/data/pageSetup";
import { describe, expect, it, vi } from "vitest";

import { PdfExportAborted, renderPdf } from "./renderPdf";

const jpeg = new Uint8Array([0xff, 0xd8, 1, 2, 3, 0xff, 0xd9]);
const drawn = { jpeg, pixelWidth: 10, pixelHeight: 20 };
const latin1 = (b: Uint8Array) => new TextDecoder("latin1").decode(b);

const input = (pageCount: number, extra = {}) => ({
  elements: [],
  appState: { pageSetup: updatePageSetup(null, { pageCount }) },
  files: null,
  ...extra,
});

describe("renderPdf", () => {
  it("renders every page in order, reports progress and yields between pages", async () => {
    const order: string[] = [];
    const drawPage = vi.fn(
      async (plan: { rect: { y: number } }, _scale: number) => {
        order.push(`draw${plan.rect.y}`);
        return drawn;
      },
    );
    const yieldToEventLoop = vi.fn(async () => void order.push("yield"));
    const onProgress = vi.fn();
    const bytes = await renderPdf(input(3, { onProgress }), {
      drawPage,
      yieldToEventLoop,
    });
    expect(drawPage).toHaveBeenCalledTimes(3);
    expect(drawPage.mock.calls[0][1]).toBe(2); // default render scale
    expect(onProgress.mock.calls).toEqual([
      [0, 3],
      [1, 3],
      [2, 3],
      [3, 3],
    ]);
    expect(order.filter((o) => o === "yield")).toHaveLength(3);
    expect(order[1]).toBe("yield");
    const pdf = latin1(bytes);
    expect(pdf).toContain("/Count 3");
    expect(pdf).toContain("/MediaBox [0 0 595 842]");
  });

  it("clamps the render scale to 1..3", async () => {
    const drawPage = vi.fn(async () => drawn);
    await renderPdf(input(1, { scale: 9 }), { drawPage });
    await renderPdf(input(1, { scale: 0 }), { drawPage });
    expect(drawPage.mock.calls.map((c) => (c as unknown[])[1])).toEqual([3, 1]);
  });

  it("stops when aborted between pages", async () => {
    const controller = new AbortController();
    const drawPage = vi.fn(async () => {
      controller.abort();
      return drawn;
    });
    await expect(
      renderPdf(input(5, { signal: controller.signal }), { drawPage }),
    ).rejects.toBeInstanceOf(PdfExportAborted);
    expect(drawPage).toHaveBeenCalledTimes(1);
  });

  it("an already aborted signal renders nothing", async () => {
    const drawPage = vi.fn(async () => drawn);
    await expect(
      renderPdf(input(2, { signal: AbortSignal.abort() }), { drawPage }),
    ).rejects.toThrow(/cancelled/);
    expect(drawPage).not.toHaveBeenCalled();
  });

  it("normal-mode drawing with no elements fails clearly", async () => {
    await expect(
      renderPdf({ elements: [], appState: {}, files: null }, {}),
    ).rejects.toThrow(/empty/);
  });

  it("propagates a page render failure", async () => {
    await expect(
      renderPdf(input(2), {
        drawPage: async () => {
          throw new Error("canvas too large");
        },
      }),
    ).rejects.toThrow("canvas too large");
  });
});
