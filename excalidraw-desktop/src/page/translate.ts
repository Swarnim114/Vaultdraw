/**
 * Moves elements without touching the live scene objects: the moved ones
 * (and the arrows bound to them) are cloned into a private Scene, so bound
 * arrows follow like they do when the user drags. Every other element keeps
 * its identity (the renderer caches by it).
 */
import { updateBoundElements, Scene } from "@excalidraw/element";

import type {
  ExcalidrawElement,
  NonDeletedExcalidrawElement,
} from "@excalidraw/element/types";

export type Move = { dx: number; dy: number };

/** Ids to clone: the movers, arrows bound to them, and those arrows' text. */
const collectAffected = (
  moves: ReadonlyMap<string, Move>,
  byId: ReadonlyMap<string, ExcalidrawElement>,
): Set<string> => {
  const affected = new Set(moves.keys());
  for (const id of moves.keys()) {
    for (const bound of byId.get(id)?.boundElements ?? []) {
      if (bound.type !== "arrow") {
        continue;
      }
      affected.add(bound.id);
      for (const label of byId.get(bound.id)?.boundElements ?? []) {
        if (label.type === "text") {
          affected.add(label.id);
        }
      }
    }
  }
  return affected;
};

/**
 * `elements` with every element in `moves` translated by its offset. Returns
 * the same array when `moves` is empty.
 */
export const translateElements = (
  elements: readonly ExcalidrawElement[],
  moves: ReadonlyMap<string, Move>,
): readonly ExcalidrawElement[] => {
  if (!moves.size) {
    return elements;
  }
  const byId = new Map(elements.map((element) => [element.id, element]));
  const clones = new Map<string, ExcalidrawElement>();
  for (const id of collectAffected(moves, byId)) {
    const element = byId.get(id);
    if (element) {
      clones.set(id, { ...element });
    }
  }
  const scene = new Scene(
    elements.map((element) => clones.get(element.id) ?? element),
    { skipValidation: true },
  );
  const movers: NonDeletedExcalidrawElement[] = [];
  for (const [id, { dx, dy }] of moves) {
    const clone = clones.get(id);
    if (clone && !clone.isDeleted) {
      scene.mutateElement(clone, { x: clone.x + dx, y: clone.y + dy });
      movers.push(clone as NonDeletedExcalidrawElement);
    }
  }
  for (const mover of movers) {
    updateBoundElements(mover, scene, { simultaneouslyUpdated: movers });
  }
  return elements.map((element) => clones.get(element.id) ?? element);
};
