/**
 * "Fit content to page": moves the whole drawing to the top of page 1 and,
 * when it is wider than the page, scales it down uniformly (never up) to fit
 * the page width. Scaling goes through the editor's own resize code (text,
 * arrows, bound labels). In the separate layout, units that would straddle a
 * page break move down to the next page. Pure: callers apply the result.
 */
import { arrayToMap } from "@excalidraw/common";
import {
  deepCopyElement,
  getCommonBounds,
  resizeMultipleElements,
  Scene,
} from "@excalidraw/element";
import { getPagePitch } from "@excalidraw/excalidraw/data/pageSetup";

import type { PageSetup } from "@excalidraw/excalidraw/data/pageSetup";

import type {
  ExcalidrawElement,
  NonDeletedExcalidrawElement,
} from "@excalidraw/element/types";

import { getExtendedPageCount } from "./pageContent";
import { getUnitBounds, partitionIntoUnits } from "./moveUnits";
import { translateElements, type Move } from "./translate";

/** Space kept around the content on the page, scene px. */
export const PAGE_CONTENT_MARGIN = 32;

export interface FitContentResult {
  elements: readonly ExcalidrawElement[];
  pageCount: number;
}

/** Moves units that cross a page break (or sit in a gap) to the next page. Separate layout only. */
const planPageBreaks = (
  setup: PageSetup,
  elements: readonly ExcalidrawElement[],
): Map<string, Move> => {
  const moves = new Map<string, Move>();
  const map = arrayToMap(elements);
  const pitch = getPagePitch(setup);
  const units = [...partitionIntoUnits(elements, map).units.values()]
    .map((ids) => ({ ids, bounds: getUnitBounds(ids, map) }))
    .filter(
      (
        unit,
      ): unit is { ids: string[]; bounds: NonNullable<typeof unit.bounds> } =>
        !!unit.bounds,
    )
    .sort((a, b) => a.bounds[1] - b.bounds[1] || a.bounds[0] - b.bounds[0]);
  let shift = 0;
  for (const { ids, bounds } of units) {
    const top = bounds[1] + shift;
    const bottom = bounds[3] + shift;
    if (bottom - top <= setup.height) {
      const pageTop = Math.floor(top / pitch) * pitch;
      if (bottom > pageTop + setup.height || top > pageTop + setup.height) {
        shift += pageTop + pitch + PAGE_CONTENT_MARGIN - top;
      }
    }
    if (shift !== 0) {
      for (const id of ids) {
        moves.set(id, { dx: 0, dy: shift });
      }
    }
  }
  return moves;
};

export const fitContentToPage = (
  elements: readonly ExcalidrawElement[],
  setup: PageSetup,
): FitContentResult | null => {
  if (!elements.some((element) => !element.isDeleted)) {
    return null;
  }
  const scene = new Scene(
    elements.map((element) => ({ ...element })),
    { skipValidation: true },
  );
  const live =
    scene.getNonDeletedElements() as readonly NonDeletedExcalidrawElement[];
  const [x1, , x2] = getCommonBounds(live);
  const targetWidth = setup.width - 2 * PAGE_CONTENT_MARGIN;
  if (x2 - x1 > targetWidth) {
    resizeMultipleElements(
      live,
      scene.getNonDeletedElementsMap(),
      "se",
      scene,
      new Map(live.map((element) => [element.id, deepCopyElement(element)])),
      { shouldMaintainAspectRatio: true, nextWidth: targetWidth },
    );
  }
  const [nx1, ny1] = getCommonBounds(live);
  const dx = PAGE_CONTENT_MARGIN - nx1;
  const dy = PAGE_CONTENT_MARGIN - ny1;
  if (dx !== 0 || dy !== 0) {
    for (const element of live) {
      scene.mutateElement(element, { x: element.x + dx, y: element.y + dy });
    }
  }
  let result: readonly ExcalidrawElement[] =
    scene.getElementsIncludingDeleted();
  if (setup.layout === "separate") {
    result = translateElements(result, planPageBreaks(setup, result));
  }
  return {
    elements: result,
    pageCount: getExtendedPageCount(setup, result, arrayToMap(result)),
  };
};
