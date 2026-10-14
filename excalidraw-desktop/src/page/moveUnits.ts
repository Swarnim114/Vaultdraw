/**
 * Elements that must move together: a group, a container with its bound
 * text, a frame with its children. Shared by enforcement and fit-content.
 */
import { getElementBounds, isTextElement } from "@excalidraw/element";

import type { ElementsMap, ExcalidrawElement } from "@excalidraw/element/types";

export type Bounds = [number, number, number, number];

export interface Partition {
  /** key -> member ids (non-deleted elements only) */
  units: Map<string, string[]>;
  keyOf(id: string): string | undefined;
}

/** Groups the non-deleted `elements` into move units. O(n). */
export const partitionIntoUnits = (
  elements: readonly ExcalidrawElement[],
  elementsMap: ElementsMap,
): Partition => {
  const keys = new Map<string, string>();
  const resolve = (element: ExcalidrawElement, depth = 0): string => {
    const known = keys.get(element.id);
    if (known) {
      return known;
    }
    let key: string;
    const parent =
      depth < 4
        ? isTextElement(element) && element.containerId
          ? elementsMap.get(element.containerId)
          : element.frameId
          ? elementsMap.get(element.frameId)
          : undefined
        : undefined;
    if (parent && !parent.isDeleted) {
      key = resolve(parent, depth + 1);
    } else if (element.groupIds.length) {
      key = `g:${element.groupIds[element.groupIds.length - 1]}`;
    } else {
      key = `e:${element.id}`;
    }
    keys.set(element.id, key);
    return key;
  };
  const units = new Map<string, string[]>();
  for (const element of elements) {
    if (element.isDeleted) {
      continue;
    }
    const key = resolve(element);
    const list = units.get(key);
    if (list) {
      list.push(element.id);
    } else {
      units.set(key, [element.id]);
    }
  }
  return { units, keyOf: (id) => keys.get(id) };
};

/** Union bounds of a unit; bound text and frame children are covered by their parent. */
export const getUnitBounds = (
  ids: readonly string[],
  elementsMap: ElementsMap,
): Bounds | null => {
  let bounds: Bounds | null = null;
  const members = new Set(ids);
  for (const id of ids) {
    const element = elementsMap.get(id);
    if (!element || element.isDeleted) {
      continue;
    }
    const parent =
      isTextElement(element) && element.containerId
        ? elementsMap.get(element.containerId)
        : element.frameId
        ? elementsMap.get(element.frameId)
        : undefined;
    if (parent && !parent.isDeleted && members.has(parent.id)) {
      continue;
    }
    const [x1, y1, x2, y2] = getElementBounds(element, elementsMap);
    bounds = bounds
      ? [
          Math.min(bounds[0], x1),
          Math.min(bounds[1], y1),
          Math.max(bounds[2], x2),
          Math.max(bounds[3], y2),
        ]
      : [x1, y1, x2, y2];
  }
  return bounds;
};
