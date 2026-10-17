// Vaultdraw: host hook to style runs of a text element on the on-screen
// canvas (e.g. `[[links]]`: colour + underline). Display only: the scene data
// is untouched and exports never call it (they draw with `isExporting`).
//
// Cost model: the styler is called only when an element's bitmap is
// (re)rasterised, never per frame. Per frame the cache check compares two
// integers. `invalidateTextRunStyles` re-rasterises only text whose last
// raster was styled; `setTextRunStyler` (install / remove) re-rasterises
// every text element once.

import type { ExcalidrawTextElement } from "./types";

export type TextRun = Readonly<{
  /** UTF-16 [start, end) into `element.text`. */
  start: number;
  end: number;
  /** Final on-screen colour (no dark mode filter is applied to it). */
  color?: string;
  underline?: "solid" | "dashed";
}>;

export type TextRunStyler = (
  element: ExcalidrawTextElement,
  isDarkMode: boolean,
) => readonly TextRun[] | null;

let styler: TextRunStyler | null = null;
let stylerEpoch = 0;
let runsVersion = 0;

export const setTextRunStyler = (next: TextRunStyler | null) => {
  styler = next;
  stylerEpoch++;
  runsVersion++;
};

/** The styler's answers changed (colours, link targets): re-style on next render. */
export const invalidateTextRunStyles = () => {
  runsVersion++;
};

export const getTextRunStylerEpoch = () => stylerEpoch;
export const getTextRunsVersion = () => runsVersion;

/** Runs for an on-screen raster, or null (no styler, nothing to style, RTL, `\r`). */
export const getTextRuns = (
  element: ExcalidrawTextElement,
  isDarkMode: boolean,
): readonly TextRun[] | null => {
  if (!styler || element.text.includes("\r")) {
    return null;
  }
  const runs = styler(element, isDarkMode);
  return runs && runs.length > 0 ? runs : null;
};

/**
 * `fillText(line, x, y)` with `runs` applied. `lineStart` is the line's offset
 * in the element text. Segment positions are prefix widths of the whole line,
 * so they match `measureText`-based hit testing. Restores the context's fill,
 * stroke and alignment.
 */
export const fillTextLineWithRuns = (
  context: CanvasRenderingContext2D,
  line: string,
  lineStart: number,
  x: number,
  y: number,
  fontSize: number,
  runs: readonly TextRun[],
) => {
  const lineEnd = lineStart + line.length;
  const local: { start: number; end: number; run: TextRun }[] = [];
  for (const run of runs) {
    const start = Math.max(run.start, lineStart) - lineStart;
    const end = Math.min(run.end, lineEnd) - lineStart;
    if (start < end) {
      local.push({ start, end, run });
    }
  }
  if (local.length === 0) {
    context.fillText(line, x, y);
    return;
  }
  local.sort((a, b) => a.start - b.start);

  const width = (n: number) =>
    n <= 0 ? 0 : context.measureText(line.slice(0, n)).width;
  const align = context.textAlign;
  const full = width(line.length);
  const left =
    align === "center" ? x - full / 2 : align === "right" ? x - full : x;
  const baseFill = context.fillStyle;
  context.textAlign = "left";

  let at = 0;
  const plain = (to: number) => {
    if (to > at) {
      context.fillStyle = baseFill;
      context.fillText(line.slice(at, to), left + width(at), y);
    }
  };
  for (const { start, end, run } of local) {
    if (start < at) {
      continue; // overlapping runs: the first one wins
    }
    plain(start);
    const x1 = left + width(start);
    context.fillStyle = run.color ?? baseFill;
    context.fillText(line.slice(start, end), x1, y);
    if (run.underline) {
      const x2 = left + width(end);
      const uy = y + fontSize * 0.12;
      context.save();
      context.strokeStyle = context.fillStyle;
      context.lineWidth = Math.max(0.75, fontSize * 0.06);
      context.setLineDash(
        run.underline === "dashed" ? [fontSize * 0.25, fontSize * 0.18] : [],
      );
      context.beginPath();
      context.moveTo(x1, uy);
      context.lineTo(x2, uy);
      context.stroke();
      context.restore();
    }
    at = end;
  }
  plain(line.length);
  context.fillStyle = baseFill;
  context.textAlign = align;
};
