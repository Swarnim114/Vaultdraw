/**
 * Apply link edits to the live scene: the open drawing's side of a rename
 * (`MoveResult.openDrawingEdits`), and "link selection to a drawing". One
 * undoable step; edited text is measured in the same update so Undo never
 * leaves clipped text behind.
 */
import { newElementWith } from "@excalidraw/element";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { measureTextUpdate } from "./remeasure";

import type { ElementEdit } from "../../links/types";

type AnyElement = Record<string, any> & { id: string; type: string };

const IMMEDIATELY = "IMMEDIATELY" as never;

/** Returns how many elements changed. */
export function applyEdits(
  api: ExcalidrawImperativeAPI,
  edits: readonly ElementEdit[],
): number {
  if (edits.length === 0) {
    return 0;
  }
  const byId = new Map<string, ElementEdit[]>();
  for (const edit of edits) {
    const list = byId.get(edit.elementId);
    if (list) {
      list.push(edit);
    } else {
      byId.set(edit.elementId, [edit]);
    }
  }
  const all = api.getSceneElementsIncludingDeleted() as unknown as AnyElement[];
  const map = new Map(all.map((e) => [e.id, e]));
  const next = new Map<string, AnyElement>();
  for (const [id, list] of byId) {
    const el = map.get(id);
    if (!el || el.isDeleted) {
      continue;
    }
    let patch: Record<string, unknown> = {};
    for (const edit of list) {
      if (edit.field === "link") {
        patch.link = edit.value || null;
      } else if (el.type === "text") {
        patch = { ...patch, text: edit.value, originalText: edit.value };
      }
    }
    if ("originalText" in patch) {
      const measured = measureTextUpdate(el, map, patch.originalText as string);
      patch = { ...patch, ...measured };
    }
    next.set(id, newElementWith(el as never, patch as never) as never);
  }
  if (next.size === 0) {
    return 0;
  }
  api.updateScene({
    elements: all.map((e) => next.get(e.id) ?? e) as never,
    captureUpdate: IMMEDIATELY,
  });
  return next.size;
}

/** Set (or clear, with null) the `link` of the given elements; undoable. */
export function setElementLinks(
  api: ExcalidrawImperativeAPI,
  ids: readonly string[],
  link: string | null,
): number {
  return applyEdits(
    api,
    ids.map((elementId) => ({ elementId, field: "link", value: link ?? "" })),
  );
}
