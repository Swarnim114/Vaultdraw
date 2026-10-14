/**
 * Export a vault drawing from the navigator without opening it: read the
 * file, restore it off-screen and render it through the same path as the
 * editor's export dialog (`renderImageExport`: standard colours, scale,
 * background, dark, embed scene), then hand the bytes to the native save
 * dialog. "Save a copy…" is a native byte-for-byte file copy.
 */

import { loadFromBlob } from "@excalidraw/excalidraw";
import { getNonDeletedElements } from "@excalidraw/element";

import type { ImageExportRequest } from "@excalidraw/excalidraw/types";

import { renderImageExport } from "../editor/imageExport";

import type { VaultRepository } from "../vault/types";

export type ExplorerExportFormat = "png" | "svg" | "copy";

export type ExplorerExportOptions = {
  scale: number;
  background: boolean;
  embedScene: boolean;
  dark: boolean;
};

type ExportRepository = Pick<
  VaultRepository,
  "readDrawing" | "exportFile" | "saveDrawingCopy"
>;

/** The one place that reads a drawing's JSON for export. */
export const readDrawingJson = async (
  repository: ExportRepository,
  handle: string,
  path: string,
): Promise<string> => (await repository.readDrawing(handle, path)).json;

/** Restores the drawing's JSON into an export request (no editor needed). */
export const sceneToExportRequest = async (
  json: string,
  name: string,
  type: "png" | "svg",
  options: ExplorerExportOptions,
  win: Window & typeof globalThis,
): Promise<ImageExportRequest> => {
  const scene = await loadFromBlob(
    new win.Blob([json], { type: "application/json" }),
    null,
    null,
    null,
  );
  return {
    type,
    // The whole (non-deleted) scene, like the dialog without "only selected".
    elements: getNonDeletedElements(
      scene.elements,
    ) as unknown as ImageExportRequest["elements"],
    // Restored appState lacks only the viewport fields (width, offsets),
    // which exports never read.
    appState: {
      ...scene.appState,
      exportScale: options.scale,
      exportBackground: options.background,
      exportEmbedScene: options.embedScene,
      exportWithDarkMode: options.dark,
    } as ImageExportRequest["appState"],
    files: scene.files,
    exportingFrame: null,
    name,
  };
};

const baseName = (path: string) => path.slice(path.lastIndexOf("/") + 1);

/**
 * Exports the drawing at `path`. Resolves false when the user cancels the
 * save dialog; rejects on errors (e.g. an empty drawing).
 */
export const exportDrawingFromVault = async (input: {
  repository: ExportRepository;
  handle: string;
  path: string;
  format: ExplorerExportFormat;
  options: ExplorerExportOptions;
  win: Window & typeof globalThis;
  /** Called with the file's JSON before the (main-thread) render starts. */
  beforeRender?: (json: string) => void | Promise<void>;
  /** Called after rendering, right before the save dialog opens. */
  onRendered?: () => void;
}): Promise<boolean> => {
  const { repository, handle, path, format, options, win } = input;
  if (format === "copy") {
    input.onRendered?.();
    return repository.saveDrawingCopy(handle, path);
  }
  const json = await readDrawingJson(repository, handle, path);
  await input.beforeRender?.(json);
  const request = await sceneToExportRequest(
    json,
    baseName(path),
    format,
    options,
    win,
  );
  const image = await renderImageExport(request, win);
  input.onRendered?.();
  return repository.exportFile(image.fileName, image.bytes);
};
