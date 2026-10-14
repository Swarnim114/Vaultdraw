import { isTransparent } from "@excalidraw/common";

import type { ExcalidrawElement } from "@excalidraw/element/types";

const OPAQUE_TYPES = new Set<string>([
  "image",
  "embeddable",
  "iframe",
  "stickynote",
]);
const INK_TYPES = new Set<string>(["text", "freedraw", "line", "arrow"]);

/**
 * Where a highlighter stroke goes in the z-order: right above the topmost
 * element that would hide it (an image, an embed or a filled shape), so it
 * sits behind all text and ink but is never lost behind a background.
 */
export const getHighlighterInsertionIndex = (
  elements: readonly ExcalidrawElement[],
): number => {
  for (let i = elements.length - 1; i >= 0; i--) {
    const el = elements[i];
    if (el.isDeleted || INK_TYPES.has(el.type)) {
      continue;
    }
    if (
      OPAQUE_TYPES.has(el.type) ||
      (el.type !== "frame" &&
        el.type !== "magicframe" &&
        !isTransparent(el.backgroundColor))
    ) {
      return i + 1;
    }
  }
  return 0;
};
