/**
 * Ranking for the `[[` popup: the palette's `rankRows` over the names list,
 * with exact incremental narrowing. A longer query can only match a subset of
 * what its prefix matched (every piece must stay a subsequence of the folded
 * name), so each keystroke re-ranks the previous keystroke's matches instead
 * of the whole vault. Backspacing finds the longest cached prefix.
 */
import { parseQuery } from "../../commands/fuzzy";
import {
  prepareDrawings,
  prepareItems,
  rankRows,
  warmDrawings,
} from "../../palette/rank";

import type { DrawingIndex, RankDrawing, RankedRow } from "../../palette/rank";

const NO_ITEMS = prepareItems([]);
const KEEP = 12;
/**
 * Wide queries (a few letters in a big vault) can match tens of thousands of
 * names, and aligning each one costs O(query x name). The scorer always ranks
 * names whose file name has every piece at a word start ("strong") above
 * scattered matches, and among strong names the order is decided by
 * exact/prefix file-name bonuses, then the shorter path. So when there are
 * more than WIDE candidates and enough strong ones, only the best SHORTLIST
 * strong names by that cheap key are aligned. Exact for the rows the popup
 * shows in practice; measured in wikiAutocomplete.bench.test.ts.
 */
const WIDE = 2000;
const SHORTLIST = 64;

const isWordStart = (norm: string, at: number) =>
  at === 0 || !/[\p{L}\p{N}]/u.test(norm[at - 1]);

/** -1 = not strong; else 2 = file name equals the query, 1 = starts with it, 0 = strong. */
function strength(pieces: readonly string[], d: RankDrawing): number {
  const { norm, base } = d.prepared;
  for (const p of pieces) {
    let found = false;
    for (
      let at = norm.indexOf(p, base);
      at >= 0;
      at = norm.indexOf(p, at + 1)
    ) {
      if (isWordStart(norm, at)) {
        found = true;
        break;
      }
    }
    if (!found) {
      return -1;
    }
  }
  const name = norm.slice(base);
  const whole = pieces.join(" ");
  return name === whole ? 2 : pieces.some((p) => name.startsWith(p)) ? 1 : 0;
}

function shortlist(
  pieces: readonly string[],
  matches: RankDrawing[],
  limit: number,
): RankDrawing[] {
  const strong: { d: RankDrawing; tier: number }[] = [];
  for (const d of matches) {
    const tier = strength(pieces, d);
    if (tier >= 0) {
      strong.push({ d, tier });
    }
  }
  if (strong.length < Math.max(limit, SHORTLIST)) {
    return matches;
  }
  strong.sort((a, b) => b.tier - a.tier || a.d.path.length - b.d.path.length);
  return strong.slice(0, SHORTLIST).map((s) => s.d);
}

function isSubsequence(piece: string, norm: string): boolean {
  let at = 0;
  for (let i = 0; i < piece.length; i++) {
    at = norm.indexOf(piece[i], at) + 1;
    if (at === 0) {
      return false;
    }
  }
  return true;
}

export class SuggestRanker {
  private names: readonly string[] | null = null;
  private index: DrawingIndex | null = null;
  private cache: { query: string; list: RankDrawing[] }[] = [];

  /**
   * Prepare the names in idle slices (text editing started), so the first
   * `[[` keystroke in a big vault does not pay the one-off preparation
   * (about 100 ms at 50k names) in one task. Returns a cancel function.
   */
  warm(names: readonly string[]): () => void {
    this.ensureIndex(names);
    return warmDrawings(this.index!);
  }

  private ensureIndex(names: readonly string[]): void {
    if (this.names !== names) {
      this.index = prepareDrawings(names, this.index);
      this.names = names;
      this.cache = [];
    }
  }

  /** Forget the narrowing cache (a new typing session starts). */
  reset(): void {
    this.cache = [];
  }

  rank(
    names: readonly string[],
    query: string,
    recent: readonly string[],
    limit: number,
  ): RankedRow[] {
    this.ensureIndex(names);
    const all = this.index!;
    const pieces = parseQuery(query);
    if (pieces.length === 0) {
      return rankRows(all, NO_ITEMS, query, recent, limit);
    }
    let source = all.list;
    for (const entry of this.cache) {
      if (query.startsWith(entry.query) && entry.list.length < source.length) {
        source = entry.list;
      }
    }
    const matches = source.filter((d) => {
      const norm = d.prepared.norm;
      return pieces.every((p) => isSubsequence(p, norm));
    });
    this.cache = [
      ...this.cache.filter((e) => e.query !== query),
      { query, list: matches },
    ].slice(-KEEP);
    const ranked =
      matches.length > WIDE ? shortlist(pieces, matches, limit) : matches;
    return rankRows(
      { list: ranked, byPath: all.byPath },
      NO_ITEMS,
      query,
      recent,
      limit,
    );
  }
}
