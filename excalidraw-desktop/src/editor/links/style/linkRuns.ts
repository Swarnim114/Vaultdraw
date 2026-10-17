/**
 * Pure parts of link styling: link spans of a text element (cached per
 * element version) and the text runs that colour them. Runs are computed only
 * when a text bitmap is rasterised, never per frame.
 */
import type { TextRun } from "@excalidraw/element";

import { parseHex } from "../../../theme/color";
import { linksOf } from "../textLinkHitTest";

import type { LinkSpan } from "../../../links/grammar";
import type { TextLike } from "../textLinkHitTest";

export type LinkPalette = {
  /** Resolved link name (and label). */
  link: string;
  /** `[[`, `]]` and the `target|` part of a resolved link. */
  dim: string;
  /** Unresolved link name. */
  unresolved: string;
  /** Brackets of an unresolved link. */
  unresolvedDim: string;
};

export const DIM_ALPHA = 0.5;
export const UNRESOLVED_ALPHA = 0.6;
export const UNRESOLVED_DIM_ALPHA = 0.35;

const RGB_RE = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i;

const channels = (color: string): [number, number, number] | null => {
  const hex = parseHex(color);
  if (hex) {
    return [
      Math.round(hex.r * 255),
      Math.round(hex.g * 255),
      Math.round(hex.b * 255),
    ];
  }
  const m = RGB_RE.exec(color.trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
};

/** The four link colours from one opaque base colour (`#rrggbb` or `rgb()`). */
export const linkPalette = (base: string): LinkPalette => {
  const c = channels(base);
  if (!c) {
    return {
      link: base,
      dim: base,
      unresolved: base,
      unresolvedDim: base,
    };
  }
  const rgba = (a: number) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
  return {
    link: `rgb(${c[0]},${c[1]},${c[2]})`,
    dim: rgba(DIM_ALPHA),
    unresolved: rgba(UNRESOLVED_ALPHA),
    unresolvedDim: rgba(UNRESOLVED_DIM_ALPHA),
  };
};

type SpanEntry = { version: number; text: string; spans: LinkSpan[] };

const EMPTY: LinkSpan[] = [];
const spanCache = new WeakMap<object, SpanEntry>();

/** Links of a text element, recomputed only when its version or text changed. */
export const linkSpansOf = (
  el: TextLike & { version?: number },
): LinkSpan[] => {
  if (!el.text.includes("[[")) {
    return EMPTY;
  }
  const version = el.version ?? 0;
  const hit = spanCache.get(el);
  if (hit && hit.version === version && hit.text === el.text) {
    return hit.spans;
  }
  const spans = linksOf(el);
  spanCache.set(el, { version, text: el.text, spans });
  return spans;
};

/**
 * Runs for `spans`: brackets dim; `target|` dim and the label emphasised for
 * `[[target|label]]`; the name in the link colour with a solid underline.
 * Unresolved links use the unresolved colours and a dashed underline.
 */
export const buildLinkRuns = (
  text: string,
  spans: readonly LinkSpan[],
  palette: LinkPalette,
  isResolved: (target: string) => boolean,
): TextRun[] => {
  const runs: TextRun[] = [];
  for (const span of spans) {
    const ok = isResolved(span.target);
    const dim = ok ? palette.dim : palette.unresolvedDim;
    const name = ok ? palette.link : palette.unresolved;
    const underline = ok ? "solid" : "dashed";
    const innerStart = span.start + 2;
    const innerEnd = span.end - 2;
    let nameStart = innerStart;
    if (span.label !== null) {
      const bar = text.indexOf("|", innerStart);
      if (bar >= 0 && bar < innerEnd) {
        nameStart = bar + 1;
      }
    }
    runs.push({ start: span.start, end: innerStart, color: dim });
    if (nameStart > innerStart) {
      runs.push({ start: innerStart, end: nameStart, color: dim });
    }
    runs.push({ start: nameStart, end: innerEnd, color: name, underline });
    runs.push({ start: innerEnd, end: span.end, color: dim });
  }
  return runs;
};
