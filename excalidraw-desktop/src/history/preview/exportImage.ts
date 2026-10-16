/**
 * Image export of a history version. The preview editor renders the same
 * image export dialog as the main editor (LayerUI shows it even with
 * `ui={false}`); its `onExportImage` lands in the desktop pipeline
 * (`renderImageExport`) and the native save, exactly like the main editor.
 */
import { CaptureUpdateAction } from "@excalidraw/excalidraw";

import type {
  ExcalidrawImperativeAPI,
  ImageExportRequest,
} from "@excalidraw/excalidraw/types";

import { renderImageExport } from "../../editor/imageExport";
import { copyToClipboard } from "../../vault/clipboard";

import type { LoadedVersion } from "./versionCache";

/** Opens the image export dialog on the preview; false when nothing to export. */
export const openImageExport = (
  previewApi: ExcalidrawImperativeAPI,
  version: Pick<LoadedVersion, "elementCount">,
): boolean => {
  if (version.elementCount === 0) {
    return false;
  }
  previewApi.updateScene({
    appState: { openDialog: { name: "imageExport" } } as any,
    captureUpdate: CaptureUpdateAction.NEVER,
  });
  return true;
};

/** `save(fileName, bytes)` is the app's native save (false = cancelled). */
export const createImageExportHandler =
  (
    save: (fileName: string, bytes: Uint8Array) => Promise<unknown>,
    getWindow: () => (Window & typeof globalThis) | null,
  ) =>
  async (request: ImageExportRequest): Promise<void> => {
    const win = getWindow();
    if (!win) {
      throw new Error("Preview window is not mounted");
    }
    const image = await renderImageExport(request, win);
    if (request.type === "clipboard" || request.type === "clipboard-svg") {
      await copyToClipboard(
        request.type === "clipboard" ? "png" : "svg",
        image.bytes,
        win,
      );
    } else {
      await save(image.fileName, image.bytes);
    }
  };
