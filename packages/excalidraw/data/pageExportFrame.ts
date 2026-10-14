/**
 * Page-shaped exports (PNG/SVG "page shape", PDF pages): the export area is
 * a page rectangle, expressed to the exporters as a synthetic frame. With
 * `exportingFrame` they size the output to exactly the frame, clip to it
 * and keep the elements overlapping it, so no exporter change is needed.
 */

import { newFrameElement } from "@excalidraw/element";

import type {
  ExcalidrawElement,
  ExcalidrawFrameElement,
  NonDeleted,
} from "@excalidraw/element/types";

import { getPageAreaBounds } from "./pageSetup";

import type { PageRect, PageSetup } from "./pageSetup";

/** A frame-like element covering `rect`, never part of the scene. */
export const createPageExportFrame = (
  rect: PageRect,
): NonDeleted<ExcalidrawFrameElement> =>
  newFrameElement({
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
    strokeColor: "transparent",
    backgroundColor: "transparent",
    strokeWidth: 0,
    roughness: 0,
    opacity: 100,
  });

/** The whole page column (all pages and the gaps between). */
export const createPageAreaExportFrame = (setup: PageSetup) => {
  const [x1, y1, x2, y2] = getPageAreaBounds(setup);
  return createPageExportFrame({
    x: x1,
    y: y1,
    width: x2 - x1,
    height: y2 - y1,
  });
};

/**
 * Elements inside a real frame are skipped by frame exports unless they
 * belong to the exporting frame, so detach them (copies; the scene is
 * untouched, and elements without a frame are passed through as is).
 */
export const detachFromFrames = <T extends ExcalidrawElement>(
  elements: readonly T[],
): readonly T[] =>
  elements.some((el) => el.frameId)
    ? elements.map((el) => (el.frameId ? { ...el, frameId: null } : el))
    : elements;
