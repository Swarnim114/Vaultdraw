/**
 * Put a rendered formula on the canvas. The SVG file is registered first, then
 * ONE updateScene (IMMEDIATELY) so insert/replace is a single undo step.
 */
import { CaptureUpdateAction } from "@excalidraw/excalidraw";
import { newElementWith, newImageElement } from "@excalidraw/element";

import type {
  ExcalidrawElement,
  ExcalidrawImageElement,
  FileId,
} from "@excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { hashSvg, svgToDataURL } from "./svgPost";

import type { FormulaData } from "./types";

export type RenderedFormula = {
  svg: string;
  width: number;
  height: number;
  source: string;
  display: boolean;
  color: string;
};

const toData = (r: RenderedFormula): FormulaData => ({
  v: 1,
  source: r.source,
  display: r.display,
  color: r.color,
  width: r.width,
  height: r.height,
});

async function registerFile(
  api: ExcalidrawImperativeAPI,
  svg: string,
): Promise<FileId> {
  const id = (await hashSvg(svg)) as FileId;
  api.addFiles([
    {
      id,
      mimeType: "image/svg+xml",
      dataURL: svgToDataURL(svg) as never,
      created: Date.now(),
    },
  ]);
  return id;
}

export async function insertFormula(
  api: ExcalidrawImperativeAPI,
  r: RenderedFormula,
): Promise<string> {
  const fileId = await registerFile(api, r.svg);
  const app = api.getAppState();
  const zoom = app.zoom.value;
  const cx = -app.scrollX + app.width / 2 / zoom;
  const cy = -app.scrollY + app.height / 2 / zoom;
  const element = newImageElement({
    type: "image",
    status: "saved",
    fileId,
    x: cx - r.width / 2,
    y: cy - r.height / 2,
    width: r.width,
    height: r.height,
    opacity: app.currentItemOpacity,
    customData: { latex: toData(r) },
  });
  api.updateScene({
    elements: [...api.getSceneElementsIncludingDeleted(), element],
    appState: { selectedElementIds: { [element.id]: true } },
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });
  return element.id;
}

/** `old` is the element's current formula data (scale reference). */
export async function replaceFormula(
  api: ExcalidrawImperativeAPI,
  element: ExcalidrawImageElement,
  old: FormulaData,
  r: RenderedFormula,
): Promise<void> {
  const fileId = await registerFile(api, r.svg);
  const s = element.width / old.width;
  const width = r.width * s;
  const height = r.height * s;
  const cx = element.x + element.width / 2;
  const cy = element.y + element.height / 2;
  const elements = api
    .getSceneElementsIncludingDeleted()
    .map((el: ExcalidrawElement) =>
      el.id === element.id
        ? newElementWith(el as ExcalidrawImageElement, {
            fileId,
            width,
            height,
            x: cx - width / 2,
            y: cy - height / 2,
            crop: null,
            customData: { ...el.customData, latex: toData(r) },
          })
        : el,
    );
  api.updateScene({
    elements,
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });
}
