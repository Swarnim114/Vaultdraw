/**
 * Ranking for the `#` popup. Tiers (best first): the full key starts with the
 * query, a path segment starts with it (`graphs` in `dsa/graphs`), the key
 * contains it, its letters appear in order (fuzzy). Ties: more drawings, then
 * key order. One linear pass over the tag list (a few thousand at most), no
 * allocation per tag.
 */
import { tagKey } from "../../tags/grammar";

import type { TagCount } from "../../tags/types";

export type RankedTag = {
  tag: TagCount;
  /** Matched character indexes into `tag.display` (no `#`). */
  positions: number[];
};

const PREFIX = 0;
const SEGMENT = 1;
const CONTAINS = 2;
const FUZZY = 3;

function tierOf(key: string, q: string): number {
  if (key.startsWith(q)) {
    return PREFIX;
  }
  if (key.includes(`/${q}`)) {
    return SEGMENT;
  }
  if (key.includes(q)) {
    return CONTAINS;
  }
  let at = 0;
  for (let i = 0; i < q.length; i++) {
    at = key.indexOf(q[i], at) + 1;
    if (at === 0) {
      return -1;
    }
  }
  return FUZZY;
}

function positionsOf(key: string, q: string, tier: number): number[] {
  if (!q) {
    return [];
  }
  let from = -1;
  if (tier === PREFIX) {
    from = 0;
  } else if (tier === SEGMENT) {
    from = key.indexOf(`/${q}`) + 1;
  } else if (tier === CONTAINS) {
    from = key.indexOf(q);
  }
  if (from >= 0) {
    return Array.from({ length: q.length }, (_, i) => from + i);
  }
  const out: number[] = [];
  let at = 0;
  for (let i = 0; i < q.length; i++) {
    at = key.indexOf(q[i], at);
    out.push(at++);
  }
  return out;
}

/** The best `limit` tags for the text typed after `#`. */
export function rankTags(
  tags: readonly TagCount[],
  query: string,
  limit: number,
): RankedTag[] {
  const q = tagKey(query);
  const hits: { t: TagCount; tier: number }[] = [];
  for (const t of tags) {
    const tier = q ? tierOf(t.tag, q) : PREFIX;
    if (tier >= 0) {
      hits.push({ t, tier });
    }
  }
  hits.sort(
    (a, b) =>
      a.tier - b.tier ||
      b.t.count - a.t.count ||
      (a.t.tag < b.t.tag ? -1 : a.t.tag > b.t.tag ? 1 : 0),
  );
  return hits.slice(0, limit).map(({ t, tier }) => ({
    tag: t,
    positions: positionsOf(t.tag, q, tier),
  }));
}
