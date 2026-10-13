import { memo } from "react";

import type { HighlightRange } from "./types";

/** Clamps to [0, length], drops empty ranges, sorts and merges overlaps. */
export function normalizeRanges(
  ranges: readonly HighlightRange[],
  length: number,
): HighlightRange[] {
  const clean = ranges
    .map(
      ([s, e]): HighlightRange => [
        Math.max(0, Math.min(length, Math.floor(s))),
        Math.max(0, Math.min(length, Math.floor(e))),
      ],
    )
    .filter(([s, e]) => e > s)
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged: HighlightRange[] = [];
  for (const [s, e] of clean) {
    const last = merged[merged.length - 1];
    if (last && s <= last[1]) {
      last[1] = Math.max(last[1], e);
    } else {
      merged.push([s, e]);
    }
  }
  return merged;
}

export const Highlighted = memo(
  ({ text, ranges }: { text: string; ranges: readonly HighlightRange[] }) => {
    const merged = normalizeRanges(ranges, text.length);
    if (merged.length === 0) {
      return <>{text}</>;
    }
    const parts: React.ReactNode[] = [];
    let cursor = 0;
    merged.forEach(([s, e], i) => {
      if (s > cursor) {
        parts.push(text.slice(cursor, s));
      }
      parts.push(
        <mark key={i} className="vault-search-mark">
          {text.slice(s, e)}
        </mark>,
      );
      cursor = e;
    });
    if (cursor < text.length) {
      parts.push(text.slice(cursor));
    }
    return <>{parts}</>;
  },
);
