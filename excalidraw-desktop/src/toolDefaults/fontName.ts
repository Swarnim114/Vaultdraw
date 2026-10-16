import { FONT_FAMILY } from "@excalidraw/common";

/** Excalidraw's name for a font id (e.g. 3 -> "Cascadia"), or the id as text. */
export const fontName = (id: number): string =>
  Object.entries(FONT_FAMILY).find(([, v]) => v === id)?.[0] ?? String(id);

/** Label of a select's unset option, naming the effective default font. */
export const defaultFontLabel = (id: number): string =>
  `Default (${fontName(id)})`;
