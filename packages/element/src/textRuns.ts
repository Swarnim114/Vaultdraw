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

type Segment = {
  text: string;
  /** Offset from the line's left edge. */
  x: number;
  /** Underline end, offset from the line's left edge. */
  x2: number;
  run: TextRun | null;
};

type LineLayout = { width: number; segments: Segment[] };

/**
 * Measured segments of a styled text, reused across re-rasters of the same
 * element bitmap (zoom changes) while the runs (by identity) and font are the
 * same. Widths are in scene units, so they don't depend on the zoom. It lives
 * on the bitmap cache entry, which font loads and element changes delete.
 */
export type TextRunLayout = {
  runs: readonly TextRun[];
  font: string;
  /** By line start offset; null = no run on that line. */
  lines: Map<number, LineLayout | null>;
};

export const textRunLayoutFor = (
  prev: TextRunLayout | null | undefined,
  runs: readonly TextRun[],
  font: string,
): TextRunLayout =>
  prev && prev.runs === runs && prev.font === font
    ? prev
    : { runs, font, lines: new Map() };

const layoutLine = (
  context: CanvasRenderingContext2D,
  line: string,
  lineStart: number,
  runs: readonly TextRun[],
): LineLayout | null => {
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
    return null;
  }
  local.sort((a, b) => a.start - b.start);
  // Prefix widths of the whole line, each measured once, so segment
  // positions match measureText-based hit testing.
  const widths = new Map<number, number>();
  const width = (n: number) => {
    if (n <= 0) {
      return 0;
    }
    let w = widths.get(n);
    if (w === undefined) {
      w = context.measureText(line.slice(0, n)).width;
      widths.set(n, w);
    }
    return w;
  };
  const segments: Segment[] = [];
  let at = 0;
  const plain = (to: number) => {
    if (to > at) {
      segments.push({
        text: line.slice(at, to),
        x: width(at),
        x2: width(to),
        run: null,
      });
    }
  };
  for (const { start, end, run } of local) {
    if (start < at) {
      continue; // overlapping runs: the first one wins
    }
    plain(start);
    segments.push({
      text: line.slice(start, end),
      x: width(start),
      x2: width(end),
      run,
    });
    at = end;
  }
  plain(line.length);
  return { width: width(line.length), segments };
};

/**
 * `fillText(line, x, y)` with `runs` applied. `lineStart` is the line's offset
 * in the element text; `layout` (optional) caches the measured segments.
 * Restores the context's fill and alignment.
 */
export const fillTextLineWithRuns = (
  context: CanvasRenderingContext2D,
  line: string,
  lineStart: number,
  x: number,
  y: number,
  fontSize: number,
  runs: readonly TextRun[],
  layout?: TextRunLayout,
) => {
  let lineLayout = layout?.lines.get(lineStart);
  if (lineLayout === undefined) {
    lineLayout = layoutLine(context, line, lineStart, runs);
    layout?.lines.set(lineStart, lineLayout);
  }
  if (!lineLayout) {
    context.fillText(line, x, y);
    return;
  }
  const align = context.textAlign;
  const left =
    align === "center"
      ? x - lineLayout.width / 2
      : align === "right"
      ? x - lineLayout.width
      : x;
  const baseFill = context.fillStyle;
  context.textAlign = "left";
  for (const { text, x: sx, x2: rx2, run } of lineLayout.segments) {
    context.fillStyle = run?.color ?? baseFill;
    context.fillText(text, left + sx, y);
    if (run?.underline) {
      // fillRect, not a stroked path: no save/restore or dash state per run
      const t = Math.max(0.75, fontSize * 0.06);
      const uy = y + fontSize * 0.12 - t / 2;
      const x1 = left + sx;
      const x2 = left + rx2;
      if (run.underline === "dashed") {
        const on = fontSize * 0.25;
        const step = on + fontSize * 0.18;
        for (let dx = x1; dx < x2; dx += step) {
          context.fillRect(dx, uy, Math.min(on, x2 - dx), t);
        }
      } else {
        context.fillRect(x1, uy, x2 - x1, t);
      }
    }
  }
  context.fillStyle = baseFill;
  context.textAlign = align;
};
