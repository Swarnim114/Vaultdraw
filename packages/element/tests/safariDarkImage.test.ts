import rough from "roughjs/bin/rough";

import { arrayToMap, MIME_TYPES, THEME } from "@excalidraw/common";
import { API } from "@excalidraw/excalidraw/tests/helpers/api";

import { clearElementCanvasCache, renderElement } from "../src/renderElement";

vi.mock("@excalidraw/common", async (importActual) => ({
  ...(await importActual<typeof import("@excalidraw/common")>()),
  isSafari: true,
}));

describe("WebKit dark-mode SVG image path", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    clearElementCanvasCache();
  });

  it("reads back from a CPU canvas and releases the scratch canvas", () => {
    const scratchCtx: any = {
      scale: vi.fn(),
      drawImage: vi.fn(),
      getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(4) })),
      putImageData: vi.fn(),
    };
    const getContext = vi.fn(() => scratchCtx);
    const scratch: any = { width: 0, height: 0, getContext };
    const realCreate = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation(((tag: string) =>
      tag === "canvas" && !scratch.used
        ? ((scratch.used = true), scratch)
        : realCreate(tag)) as any);

    const el: any = API.createElement({
      type: "image",
      fileId: "f" as any,
      width: 10,
      height: 10,
    });
    const img: any = { naturalWidth: 10, naturalHeight: 10 };
    const map = arrayToMap([el]) as any;
    const drawn: any[] = [];
    const ctx: any = new Proxy(
      {},
      {
        get: (_t, k) =>
          k === "drawImage" ? (...a: any[]) => drawn.push(a) : () => undefined,
        set: () => true,
      },
    );
    renderElement(
      el,
      map,
      map,
      rough.canvas(realCreate("canvas")),
      ctx,
      {
        canvasBackgroundColor: "#fff",
        imageCache: new Map([["f", { image: img, mimeType: MIME_TYPES.svg }]]),
        renderGrid: false,
        isExporting: true,
        embedsValidationStatus: new Map(),
        elementsPendingErasure: new Set(),
        pendingFlowchartNodes: null,
        theme: THEME.DARK,
      } as any,
      {
        zoom: { value: 1 },
        scrollX: 0,
        scrollY: 0,
        theme: THEME.DARK,
        selectedElementIds: {},
        frameRendering: {
          enabled: true,
          clip: true,
          name: true,
          outline: true,
        },
      } as any,
    );

    expect(getContext).toHaveBeenCalledWith("2d", { willReadFrequently: true });
    expect(scratchCtx.getImageData).toHaveBeenCalled();
    expect(drawn.some((a) => a[0] === scratch)).toBe(true);
    expect(scratch.width).toBe(0);
    expect(scratch.height).toBe(0);
  });
});
