/**
 * Ranking for the `[[` popup: the palette's `rankRows` over the names list,
 * with exact incremental narrowing. A longer query can only match a subset of
 * what its prefix matched (every piece must stay a subsequence of the folded
 * name), so each keystroke re-ranks the previous keystroke's matches instead
 * of the whole vault. Backspacing finds the longest cached prefix.
 */
import { parseQuery } from "../../commands/fuzzy";
import { prepareDrawings, prepareItems, rankRows } from "../../palette/rank";

import type { DrawingIndex, RankDrawing, RankedRow } from "../../palette/rank";

const NO_ITEMS = prepareItems([]);
const KEEP = 12;

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
    if (this.names !== names) {
      this.index = prepareDrawings(names, this.index);
      this.names = names;
      this.cache = [];
    }
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
    return rankRows(
      { list: matches, byPath: all.byPath },
      NO_ITEMS,
      query,
      recent,
      limit,
    );
  }
}
