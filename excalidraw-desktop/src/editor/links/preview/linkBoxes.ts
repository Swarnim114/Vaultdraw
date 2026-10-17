/**
 * Pointer hit test over cached link boxes. Per text element the links with
 * their per-line fragments are measured once and kept in a WeakMap keyed by
 * the element object (validated by `version`), so a pointer frame is only
 * arithmetic: topmost-first scan, cheap rotated AABB check, then fragments.
 */
import { textLinksWithGeometry } from "../textLinkHitTest";

import type {
  MeasureFn,
  Point,
  TextLike,
  TextLinkHit,
} from "../textLinkHitTest";

export type VersionedText = TextLike & { version?: number };

type Entry = { version: number; hits: TextLinkHit[] };

const cache = new WeakMap<object, Entry>();

/** Cached links (with fragments) of a text element. */
export function linkBoxesOf(el: VersionedText, measure?: MeasureFn) {
  const version = el.version ?? 0;
  const entry = cache.get(el);
  if (entry && entry.version === version) {
    return entry.hits;
  }
  const hits = textLinksWithGeometry(el, measure);
  cache.set(el, { version, hits });
  return hits;
}

/** The link under a scene point, topmost element first. No measuring on cache hits. */
export function linkAt(
  elements: readonly VersionedText[],
  point: Point,
  measure?: MeasureFn,
): TextLinkHit | null {
  for (let i = elements.length - 1; i >= 0; i--) {
    const el = elements[i];
    if (el.type !== "text" || el.isDeleted || !el.text.includes("[[")) {
      continue;
    }
    let { x, y } = point;
    if (el.angle) {
      const cx = el.x + el.width / 2;
      const cy = el.y + el.height / 2;
      const cos = Math.cos(-el.angle);
      const sin = Math.sin(-el.angle);
      const dx = x - cx;
      const dy = y - cy;
      x = cx + dx * cos - dy * sin;
      y = cy + dx * sin + dy * cos;
    }
    if (x < el.x || x > el.x + el.width || y < el.y || y > el.y + el.height) {
      continue;
    }
    for (const hit of linkBoxesOf(el, measure)) {
      for (const f of hit.fragments) {
        if (x >= f.x1 && x <= f.x2 && y >= f.top && y <= f.bottom) {
          return hit;
        }
      }
    }
  }
  return null;
}
