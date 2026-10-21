/**
 * Excalidraw exports in the editor theme (exportWithDarkMode follows the
 * theme), so a dark-mode "Copy SVG" carries the dark-filtered drawing colour
 * (#1e1e1e inverts to #d3d3d3) on the standard #121212 background. What must
 * never appear is a theme-palette colour (Dracula etc.).
 */
export const DRAWING_STROKE = "#1e1e1e";
export const DARK_FILTERED_STROKE = "#d3d3d3";

export const expectedClipboardStroke = (dark: boolean) =>
  dark ? DARK_FILTERED_STROKE : DRAWING_STROKE;

export const clipboardColourProblem = (
  colours: string[],
  themeColours: ReadonlySet<string>,
  dark: boolean,
): string | null => {
  const themed = colours.filter((c) => themeColours.has(c));
  const stroke = expectedClipboardStroke(dark);
  if (themed.length || !colours.includes(stroke)) {
    return `Clipboard SVG colours ${JSON.stringify(
      colours,
    )} (themed ${JSON.stringify(
      themed,
    )}), expected the drawing's ${stroke} and no theme colours`;
  }
  return null;
};
