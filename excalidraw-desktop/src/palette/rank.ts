/**
 * Ranking for the unified palette: drawings and provider items in one list.
 * Pure; reuses the one fuzzy scorer. Rules (best first):
 *  - item title equals the query (+EXACT_TIER) or starts with it (+PREFIX_TIER),
 *    which beats any fuzzy drawing score;
 *  - then fuzzy score (drawings keep fuzzy.ts's basename bonuses);
 *  - recent entries get a boost that decays with their MRU position;
 *  - items matching only via keywords (title + keywords haystack) count half.
 * "> text" restricts to items. An empty query lists recents (MRU), then the
 * first drawings, then the remaining items. Output is capped at `maxRows`.
 */
import { filter, parseQuery, prepare } from "../commands/fuzzy";

import type { Prepared } from "../commands/fuzzy";
import type { PaletteItem } from "./types";

export const MAX_ROWS = 80;
const EMPTY_QUERY_DRAWINGS = 50;
const EXACT_TIER = 5000;
const PREFIX_TIER = 2000;
const RECENT_BOOST = 80;
const RECENT_DECAY = 2;
const KEYWORD_WEIGHT = 0.5;

export const drawingKey = (path: string) => `drawing:${path}`;

export interface RankDrawing {
  path: string;
  prepared: Prepared;
}
export interface DrawingIndex {
  list: RankDrawing[];
  byPath: Map<string, RankDrawing>;
}
export interface RankItem {
  item: PaletteItem;
  title: Prepared;
  /** Title + keywords, for keyword-only matches (null = no keywords). */
  loose: Prepared | null;
}
export interface ItemIndex {
  list: RankItem[];
  byKey: Map<string, RankItem>;
}

export type RankedRow =
  | {
      kind: "drawing";
      key: string;
      drawing: RankDrawing;
      positions: number[];
    }
  | { kind: "item"; key: string; entry: RankItem; positions: number[] };

export function prepareDrawings(paths: readonly string[]): DrawingIndex {
  const list = paths.map((path) => ({ path, prepared: prepare(path) }));
  return { list, byPath: new Map(list.map((d) => [d.path, d])) };
}

export function prepareItems(items: readonly PaletteItem[]): ItemIndex {
  const list = items.map((item) => ({
    item,
    title: prepare(item.title),
    loose: item.keywords?.length
      ? prepare(`${item.title} ${item.keywords.join(" ")}`)
      : null,
  }));
  return { list, byKey: new Map(list.map((e) => [e.item.key, e])) };
}

const drawingRow = (drawing: RankDrawing, positions: number[]): RankedRow => ({
  kind: "drawing",
  key: drawingKey(drawing.path),
  drawing,
  positions,
});
const itemRow = (entry: RankItem, positions: number[]): RankedRow => ({
  kind: "item",
  key: entry.item.key,
  entry,
  positions,
});

function emptyQueryRows(
  drawings: DrawingIndex,
  items: ItemIndex,
  recent: readonly string[],
  itemsOnly: boolean,
  maxRows: number,
): RankedRow[] {
  const out: RankedRow[] = [];
  const seen = new Set<string>();
  for (const key of recent) {
    const entry = items.byKey.get(key);
    if (entry) {
      out.push(itemRow(entry, []));
      seen.add(key);
    } else if (!itemsOnly && key.startsWith("drawing:")) {
      const drawing = drawings.byPath.get(key.slice("drawing:".length));
      if (drawing) {
        out.push(drawingRow(drawing, []));
        seen.add(key);
      }
    }
  }
  if (!itemsOnly) {
    let shown = 0;
    for (const d of drawings.list) {
      if (shown === EMPTY_QUERY_DRAWINGS || out.length >= maxRows) {
        break;
      }
      if (!seen.has(drawingKey(d.path))) {
        out.push(drawingRow(d, []));
        shown++;
      }
    }
  }
  for (const entry of items.list) {
    if (out.length >= maxRows) {
      break;
    }
    if (!seen.has(entry.item.key)) {
      out.push(itemRow(entry, []));
    }
  }
  return out.slice(0, maxRows);
}

export function rankRows(
  drawings: DrawingIndex,
  items: ItemIndex,
  query: string,
  recent: readonly string[],
  maxRows: number = MAX_ROWS,
): RankedRow[] {
  const itemsOnly = query.startsWith(">");
  const text = itemsOnly ? query.slice(1) : query;
  const pieces = parseQuery(text);
  if (pieces.length === 0) {
    return emptyQueryRows(drawings, items, recent, itemsOnly, maxRows);
  }
  const needle = pieces.join(" ");
  const boost = new Map<string, number>();
  recent.forEach((key, i) =>
    boost.set(key, Math.max(0, RECENT_BOOST - i * RECENT_DECAY)),
  );

  const scored: { score: number; row: RankedRow }[] = [];
  const matched = new Set<string>();

  for (const hit of filter(
    items.list,
    text,
    (e) => e.title,
    items.list.length,
  )) {
    const { norm } = hit.item.title;
    const tier =
      norm === needle ? EXACT_TIER : norm.startsWith(needle) ? PREFIX_TIER : 0;
    const key = hit.item.item.key;
    matched.add(key);
    scored.push({
      score: hit.score + tier + (boost.get(key) ?? 0),
      row: itemRow(hit.item, hit.positions),
    });
  }
  const unmatched = items.list.filter(
    (e) => e.loose && !matched.has(e.item.key),
  );
  for (const hit of filter(
    unmatched,
    text,
    (e) => e.loose!,
    unmatched.length,
  )) {
    const titleLength = hit.item.item.title.length;
    scored.push({
      score:
        Math.floor(hit.score * KEYWORD_WEIGHT) +
        (boost.get(hit.item.item.key) ?? 0),
      row: itemRow(
        hit.item,
        hit.positions.filter((p) => p < titleLength),
      ),
    });
  }
  if (!itemsOnly) {
    for (const hit of filter(drawings.list, text, (d) => d.prepared, maxRows)) {
      scored.push({
        score: hit.score + (boost.get(drawingKey(hit.item.path)) ?? 0),
        row: drawingRow(hit.item, hit.positions),
      });
    }
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, maxRows).map((s) => s.row);
}
