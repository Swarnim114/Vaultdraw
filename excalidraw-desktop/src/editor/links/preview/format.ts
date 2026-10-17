import { stripExtension } from "../../../links/grammar";
import { baseOf, folderOf } from "../../../links/resolve";

import type { OpenModifier } from "../../../links/types";
import type { UnderlineRect } from "../modifierLinks";

export const nameOfPath = (path: string) => stripExtension(baseOf(path));
export const folderLabel = (path: string) => folderOf(path) || "Vault root";

export function modifierLabel(
  modifier: OpenModifier,
  mac = /Mac|iPhone|iPad/.test(
    typeof navigator === "undefined" ? "" : navigator.platform,
  ),
): string {
  switch (modifier) {
    case "alt":
      return mac ? "⌥" : "Alt";
    case "shift":
      return mac ? "⇧" : "Shift";
    case "ctrl":
      return mac ? "⌃" : "Ctrl";
    default:
      return mac ? "⌘" : "Ctrl";
  }
}

export const CARD_W = 260;
export const CARD_H = 200;
const GAP = 6;
const MARGIN = 4;

/**
 * Card position in container coordinates: below the last underline, flipped
 * above the first fragment when it would overflow the bottom, clamped sideways.
 */
export function cardPosition(
  rects: readonly UnderlineRect[],
  lineHeight: number,
  box: { left: number; top: number; width: number; height: number },
): { left: number; top: number; above: boolean } {
  const first = rects[0];
  const last = rects[rects.length - 1];
  const maxLeft = Math.max(MARGIN, box.width - CARD_W - MARGIN);
  const left = Math.min(maxLeft, Math.max(MARGIN, first.left - box.left));
  const below = last.top - box.top + GAP;
  if (below + CARD_H <= box.height) {
    return { left, top: below, above: false };
  }
  const above = first.top - box.top - lineHeight - GAP - CARD_H;
  return { left, top: Math.max(MARGIN, above), above: true };
}
