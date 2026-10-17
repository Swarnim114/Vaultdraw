/** Where imported PDF pages go. Pure. */
import { arrayToMap } from "@excalidraw/common";
import { getCommonBounds, getNonDeletedElements } from "@excalidraw/element";
import {
  getPageIndexAt,
  getPageRect,
  isPageModeOn,
  PAGE_GAP,
  PAGE_LIMITS,
} from "@excalidraw/excalidraw/data/pageSetup";

import type { PageSetup } from "@excalidraw/excalidraw/data/pageSetup";
import type { ExcalidrawElement } from "@excalidraw/element/types";

import { getContentBottom } from "../page/pageContent";

import type { PdfPageInfo } from "./types";

export type PlacementRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type PdfPlacement = {
  rects: PlacementRect[];
  /** Page mode: the page count to set (start + n). */
  pageCount?: number;
  /** Page mode: first page used. */
  startPage?: number;
  /** Page mode: pages that still fit (limit - start). Infinity otherwise. */
  maxPagesThatFit: number;
};

const PT_TO_SCENE = 96 / 72;

export const planPdfPlacement = ({
  pages,
  indices,
  elements,
  pageSetup,
}: {
  pages: readonly PdfPageInfo[];
  indices: readonly number[];
  elements: readonly ExcalidrawElement[];
  pageSetup: PageSetup | null | undefined;
}): PdfPlacement => {
  const live = getNonDeletedElements(elements);
  const size = (i: number) => ({
    width: pages[i].widthPt * PT_TO_SCENE,
    height: pages[i].heightPt * PT_TO_SCENE,
  });

  if (pageSetup && isPageModeOn(pageSetup)) {
    const bottom = getContentBottom(pageSetup, live, arrayToMap(live));
    const start =
      bottom > 0 ? getPageIndexAt(pageSetup, bottom - 0.001) + 1 : 0;
    const rects = indices.map((pageIndex, k) => {
      const slot = getPageRect(pageSetup, start + k);
      const s = size(pageIndex);
      const scale = Math.min(slot.width / s.width, slot.height / s.height);
      // round inwards so the fit never leaves the page
      const width = Math.floor(s.width * scale);
      const height = Math.floor(s.height * scale);
      return {
        x: slot.x + Math.floor((slot.width - width) / 2),
        y: slot.y + Math.floor((slot.height - height) / 2),
        width,
        height,
      };
    });
    return {
      rects,
      startPage: start,
      // never drop pages the drawing already has
      pageCount: Math.min(
        PAGE_LIMITS.pageCount.max,
        Math.max(pageSetup.pageCount, start + indices.length),
      ),
      maxPagesThatFit: Math.max(0, PAGE_LIMITS.pageCount.max - start),
    };
  }

  let x = 0;
  let y = 0;
  if (live.length) {
    const [minX, , , maxY] = getCommonBounds(live);
    x = minX;
    y = maxY + PAGE_GAP;
  }
  const rects = indices.map((pageIndex) => {
    const s = size(pageIndex);
    const rect = { x, y, ...s };
    y += s.height + PAGE_GAP;
    return rect;
  });
  return { rects, maxPagesThatFit: Infinity };
};
