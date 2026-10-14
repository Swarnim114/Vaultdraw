import { createBackgroundPattern } from "@excalidraw/excalidraw/data/backgroundPattern";

import type {
  BackgroundPattern,
  BackgroundPatternType,
} from "@excalidraw/excalidraw/data/backgroundPattern";

import { getDefaultBackgroundPattern } from "../../vault/paperDefaults";

/**
 * The pattern to use after picking `type` (null = plain) over `current`:
 * unchanged when it is already that style, the user's tuned app default when
 * that has the chosen style, else the style's preset.
 */
export const selectPaperStyle = (
  type: BackgroundPatternType | null,
  current: BackgroundPattern | null,
): BackgroundPattern | null => {
  if (!type) {
    return null;
  }
  if (current?.type === type) {
    return current;
  }
  const appDefault = getDefaultBackgroundPattern();
  return appDefault?.type === type ? appDefault : createBackgroundPattern(type);
};
