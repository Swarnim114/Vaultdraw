/**
 * What the drawing holds relative to the pages: how far down it reaches
 * (auto-extend) and which elements lie outside every page (old drawings).
 * Incremental: callers pass only the elements that changed.
 */
import {
  getAutoExtendedPageCount,
  isBoundsInsidePage,
} from "@excalidraw/excalidraw/data/pageSetup";
import { getElementBounds, isTextElement } from "@excalidraw/element";

import type { PageSetup } from "@excalidraw/excalidraw/data/pageSetup";
import type { ElementsMap, ExcalidrawElement } from "@excalidraw/element/types";

/** Lowest bottom (scene y) of the non-deleted `elements` that overlap the page column below y = 0; 0 when none. */
export const getContentBottom = (
  setup: PageSetup,
  elements: readonly ExcalidrawElement[],
  elementsMap: ElementsMap,
): number => {
  let bottom = 0;
  for (const element of elements) {
    if (element.isDeleted) {
      continue;
    }
    const [x1, , x2, y2] = getElementBounds(element, elementsMap);
    if (x2 >= 0 && x1 <= setup.width && y2 > bottom) {
      bottom = y2;
    }
  }
  return bottom;
};

/** The page count after auto-extend for `changed` elements (never fewer than now). */
export const getExtendedPageCount = (
  setup: PageSetup,
  changed: readonly ExcalidrawElement[],
  elementsMap: ElementsMap,
): number =>
  getAutoExtendedPageCount(
    setup,
    getContentBottom(setup, changed, elementsMap),
  );

/** Ids of elements not fully inside a page, kept up to date from change lists. */
export class OutsideIndex {
  private ids = new Set<string>();

  get size() {
    return this.ids.size;
  }

  clear() {
    this.ids.clear();
  }

  /** Re-judge `changed` (bound text follows its container: not counted). */
  update(
    setup: PageSetup,
    changed: readonly ExcalidrawElement[],
    elementsMap: ElementsMap,
  ): void {
    for (const element of changed) {
      if (
        element.isDeleted ||
        (isTextElement(element) && element.containerId)
      ) {
        this.ids.delete(element.id);
      } else if (
        isBoundsInsidePage(setup, getElementBounds(element, elementsMap))
      ) {
        this.ids.delete(element.id);
      } else {
        this.ids.add(element.id);
      }
    }
  }

  /** Re-judge everything (the pages changed shape). */
  rebuild(
    setup: PageSetup,
    elements: readonly ExcalidrawElement[],
    elementsMap: ElementsMap,
  ): void {
    this.ids.clear();
    this.update(setup, elements, elementsMap);
  }
}
