/**
 * Renders an image export request from the editor's export dialog (or the
 * copy-as-PNG/SVG actions) into bytes. Mirrors the semantics of
 * packages/excalidraw/data exportCanvas, minus the browser file/clipboard
 * sinks: the shell saves or copies the bytes natively.
 */

import { exportToBlob, exportToSvg } from "@excalidraw/excalidraw";
import { SVG_DOCUMENT_PREAMBLE } from "@excalidraw/common";

import type { ImageExportRequest } from "@excalidraw/excalidraw/types";

import { withStandardCanvasColors } from "./canvasSync";

export type RenderedImage = {
  bytes: Uint8Array;
  fileName: string;
  mime: "image/png" | "image/svg+xml";
};

const isClipboard = (type: ImageExportRequest["type"]) =>
  type === "clipboard" || type === "clipboard-svg";

export const exportFileName = (
  drawingName: string,
  extension: "png" | "svg",
  embedScene: boolean,
) => {
  const base = drawingName.replace(/\.excalidraw$/i, "") || "Drawing";
  return `${base}${embedScene ? ".excalidraw" : ""}.${extension}`;
};

export const renderImageExport = (
  request: ImageExportRequest,
  win: Window & typeof globalThis,
): Promise<RenderedImage> => {
  if (request.elements.length === 0) {
    return Promise.reject(new Error("Cannot export an empty canvas."));
  }
  const svg = request.type === "svg" || request.type === "clipboard-svg";
  // Scene embedding applies to files only, never to the clipboard.
  const embedScene =
    !isClipboard(request.type) && request.appState.exportEmbedScene;
  const options = {
    elements: request.elements,
    appState: { ...request.appState, exportEmbedScene: embedScene },
    files: request.files,
    exportingFrame: request.exportingFrame,
  };
  // Exports never contain the theme's on-screen colours (the transform is
  // global), so the whole render runs with canvas sync suspended.
  return withStandardCanvasColors(async () => {
    if (svg) {
      const element = await exportToSvg({
        ...options,
        renderEmbeddables: false,
      });
      const text =
        SVG_DOCUMENT_PREAMBLE +
        new win.XMLSerializer().serializeToString(element);
      return {
        bytes: new TextEncoder().encode(text),
        fileName: exportFileName(request.name, "svg", embedScene),
        mime: "image/svg+xml" as const,
      };
    }
    // The public exportToBlob ignores appState.exportScale unless it gets
    // getDimensions (the editor's own export path sizes the canvas itself).
    const scale = request.appState.exportScale || 1;
    const blob = await exportToBlob({
      ...options,
      mimeType: "image/png",
      getDimensions: (width, height) => ({
        width: width * scale,
        height: height * scale,
        scale,
      }),
    });
    return {
      bytes: new Uint8Array(await blob.arrayBuffer()),
      fileName: exportFileName(request.name, "png", embedScene),
      mime: "image/png" as const,
    };
  });
};
