import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  RENDER_VERSION,
  THUMB_FILES_JSON_BYTES,
  THUMB_MAX_ELEMENTS,
  THUMB_MAX_JSON_BYTES,
  THUMB_PNG_EDGE,
  renderScenePng,
  renderSceneToSvgDataUrl,
} from "./render";

const exportToCanvas = vi.fn();
const exportToSvg = vi.fn();
vi.mock("@excalidraw/excalidraw", () => ({ exportToCanvas, exportToSvg }));
vi.mock("../editor/canvasSync", () => ({
  withStandardCanvasColors: (task: () => Promise<unknown>) => task(),
  suspendCanvasSync: () => () => {},
}));

const scene = (n: number, extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    elements: Array.from({ length: n }, (_, i) => ({ id: `e${i}` })),
    appState: { viewBackgroundColor: "#fff" },
    files: { f1: { dataURL: "data:x" } },
    ...extra,
  });

const fakeCanvas = (type = "image/png") => {
  const canvas: any = {
    width: 100,
    toBlob: (cb: (b: Blob | null) => void) =>
      cb(type ? new Blob([new Uint8Array([1])], { type }) : null),
  };
  return canvas;
};

beforeEach(() => {
  exportToCanvas.mockReset();
  exportToSvg.mockReset();
});

describe("renderScenePng", () => {
  it("renders an opaque PNG at the thumbnail edge and frees the canvas", async () => {
    const canvas = fakeCanvas();
    exportToCanvas.mockResolvedValue(canvas);
    const res = await renderScenePng(scene(3));
    expect(res.kind).toBe("png");
    const arg = exportToCanvas.mock.calls[0][0];
    expect(arg.maxWidthOrHeight).toBe(THUMB_PNG_EDGE);
    expect(arg.appState.exportBackground).toBe(true);
    expect(arg.appState.exportWithDarkMode).toBe(false);
    expect(arg.files).toEqual({ f1: { dataURL: "data:x" } });
    expect(canvas.width).toBe(0);
  });

  it("fails without rendering for invalid, empty and over-cap scenes", async () => {
    expect(await renderScenePng("nope")).toEqual({
      kind: "fail",
      reason: "invalid",
    });
    expect(await renderScenePng(scene(0))).toEqual({
      kind: "fail",
      reason: "empty",
    });
    expect(await renderScenePng(scene(THUMB_MAX_ELEMENTS + 1))).toEqual({
      kind: "fail",
      reason: "too-many",
    });
    expect(
      await renderScenePng(scene(1, { pad: "x".repeat(THUMB_MAX_JSON_BYTES) })),
    ).toEqual({
      kind: "fail",
      reason: "too-large",
    });
    expect(exportToCanvas).not.toHaveBeenCalled();
  });

  it("drops embedded files above the files size limit", async () => {
    exportToCanvas.mockResolvedValue(fakeCanvas());
    await renderScenePng(scene(1, { pad: "x".repeat(THUMB_FILES_JSON_BYTES) }));
    expect(exportToCanvas.mock.calls[0][0].files).toEqual({});
  });

  it("fails when the blob is not a PNG or the export throws", async () => {
    exportToCanvas.mockResolvedValueOnce(fakeCanvas("image/webp"));
    expect(await renderScenePng(scene(1))).toEqual({
      kind: "fail",
      reason: "encode",
    });
    exportToCanvas.mockResolvedValueOnce(fakeCanvas(""));
    expect(await renderScenePng(scene(1))).toEqual({
      kind: "fail",
      reason: "encode",
    });
    exportToCanvas.mockRejectedValueOnce(new Error("boom"));
    expect(await renderScenePng(scene(1))).toEqual({
      kind: "fail",
      reason: "error",
    });
  });
});

describe("renderSceneToSvgDataUrl", () => {
  it("keeps the old behaviour: null for invalid/empty, data URL otherwise", async () => {
    expect(await renderSceneToSvgDataUrl("x")).toBeNull();
    expect(await renderSceneToSvgDataUrl('{"elements":[]}')).toBeNull();
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("width", "480");
    svg.setAttribute("height", "240");
    exportToSvg.mockResolvedValue(svg);
    const url = await renderSceneToSvgDataUrl(scene(2));
    expect(url).toMatch(/^data:image\/svg\+xml/);
    expect(decodeURIComponent(url!)).toContain('width="240"');
    expect(exportToSvg.mock.calls[0][0].files).toEqual({
      f1: { dataURL: "data:x" },
    });
  });
});

it("exports a render version", () => {
  expect(RENDER_VERSION).toBeGreaterThanOrEqual(1);
});
