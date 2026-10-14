/** Element builders for the page tests. */
import {
  newArrowElement,
  newElement,
  newTextElement,
} from "@excalidraw/element";

import type {
  ExcalidrawArrowElement,
  ExcalidrawElement,
  ExcalidrawTextElement,
} from "@excalidraw/element/types";

let n = 0;
const id = (prefix: string) => `${prefix}${++n}`;

export const rect = (
  x: number,
  y: number,
  width = 100,
  height = 60,
  extra: Partial<ExcalidrawElement> = {},
): ExcalidrawElement =>
  ({
    ...newElement({ type: "rectangle", x, y, width, height }),
    id: id("r"),
    ...extra,
  } as ExcalidrawElement);

export const boundText = (
  container: ExcalidrawElement,
  text = "hi",
): { container: ExcalidrawElement; text: ExcalidrawTextElement } => {
  const label = {
    ...newTextElement({
      text,
      x: container.x + 10,
      y: container.y + 10,
      containerId: container.id,
    }),
    id: id("t"),
  } as ExcalidrawTextElement;
  return {
    container: {
      ...container,
      boundElements: [{ type: "text", id: label.id }],
    } as ExcalidrawElement,
    text: label,
  };
};

export const arrow = (
  x: number,
  y: number,
  dx: number,
  dy: number,
  extra: Partial<ExcalidrawArrowElement> = {},
): ExcalidrawArrowElement =>
  ({
    ...newArrowElement({
      type: "arrow",
      x,
      y,
      width: Math.abs(dx),
      height: Math.abs(dy),
      points: [
        [0, 0],
        [dx, dy],
      ] as any,
    }),
    id: id("a"),
    ...extra,
  } as ExcalidrawArrowElement);

export const toMap = (elements: readonly ExcalidrawElement[]) =>
  new Map(elements.map((e) => [e.id, e])) as any;

/** A new version of `element` (as an editor change would make it). */
export const touch = <T extends ExcalidrawElement>(
  element: T,
  changes: Partial<T> = {},
): T => ({ ...element, ...changes, version: element.version + 1 });
