/**
 * Commit-time page enforcement. The editor clamps pointer gestures live;
 * this pulls back everything else (paste, duplicate, nudge, align, flip,
 * library inserts, text that grew, undo/redo) once it is committed.
 *
 * Rule: only elements ADDED or CHANGED since the last check are looked at.
 * One that is not where content may be (getClampToPageOffset) is translated
 * into the page nearest its centre, together with everything that moves
 * with it (group, bound text, frame children). Anything that was already
 * outside and was not touched stays where it is: old drawings are never
 * rearranged.
 */
import { getClampToPageOffset } from "@excalidraw/excalidraw/data/pageSetup";
import { isTextElement } from "@excalidraw/element";

import type { PageSetup } from "@excalidraw/excalidraw/data/pageSetup";

import type { ElementsMap, ExcalidrawElement } from "@excalidraw/element/types";

import { getUnitBounds, partitionIntoUnits, type Bounds } from "./moveUnits";
import { translateElements, type Move } from "./translate";

/** Elements that carry the check: bound text is judged through its container. */
const candidateOf = (
  element: ExcalidrawElement,
  elementsMap: ElementsMap,
): ExcalidrawElement | null => {
  if (element.isDeleted) {
    return null;
  }
  if (isTextElement(element) && element.containerId) {
    const container = elementsMap.get(element.containerId);
    return container && !container.isDeleted ? container : null;
  }
  return element;
};

/** Translation per element id that brings the changed elements back inside; empty = all fine. */
export const planEnforcement = (
  setup: PageSetup,
  elements: readonly ExcalidrawElement[],
  changed: readonly ExcalidrawElement[],
  selectedIds: Readonly<Record<string, true>>,
  elementsMap: ElementsMap,
): Map<string, Move> => {
  const moves = new Map<string, Move>();
  const outside: ExcalidrawElement[] = [];
  const seen = new Set<string>();
  for (const element of changed) {
    const candidate = candidateOf(element, elementsMap);
    if (!candidate || seen.has(candidate.id)) {
      continue;
    }
    seen.add(candidate.id);
    const bounds = getUnitBounds([candidate.id], elementsMap);
    if (!bounds) {
      continue;
    }
    const { dx, dy } = getClampToPageOffset(setup, bounds);
    if (dx !== 0 || dy !== 0) {
      outside.push(candidate);
    }
  }
  if (!outside.length) {
    return moves;
  }

  const partition = partitionIntoUnits(elements, elementsMap);
  // outside elements that are part of the selection move as one set
  const selected = outside.filter((element) => selectedIds[element.id]);
  const keys = new Map<string, string[]>();
  for (const element of outside) {
    const base = partition.keyOf(element.id) ?? `e:${element.id}`;
    const key = selected.length > 1 && selectedIds[element.id] ? "sel" : base;
    const list = keys.get(key);
    if (list) {
      list.push(base);
    } else {
      keys.set(key, [base]);
    }
  }
  for (const bases of keys.values()) {
    const ids = [...new Set(bases)].flatMap(
      (base) => partition.units.get(base) ?? [],
    );
    const bounds: Bounds | null = getUnitBounds(ids, elementsMap);
    if (!bounds) {
      continue;
    }
    const { dx, dy } = getClampToPageOffset(setup, bounds);
    if (dx === 0 && dy === 0) {
      continue;
    }
    for (const id of ids) {
      if (!moves.has(id)) {
        moves.set(id, { dx, dy });
      }
    }
  }
  return moves;
};

/** `elements` with the planned moves applied (same array when there are none). */
export const enforceChanged = (
  setup: PageSetup,
  elements: readonly ExcalidrawElement[],
  changed: readonly ExcalidrawElement[],
  selectedIds: Readonly<Record<string, true>>,
  elementsMap: ElementsMap,
): readonly ExcalidrawElement[] =>
  translateElements(
    elements,
    planEnforcement(setup, elements, changed, selectedIds, elementsMap),
  );
