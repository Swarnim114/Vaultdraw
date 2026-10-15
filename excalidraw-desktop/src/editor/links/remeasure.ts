/**
 * Re-measure text elements whose text Vaultdraw rewrote (rename rewrites,
 * `remeasure.json`). Only the given ids are touched. Rust cannot measure, so
 * the stale `width`/`height` (and the wrapped `text`) are repaired here, after
 * the fonts are loaded, without an undo entry.
 */
import { getFontString } from "@excalidraw/common";
import {
  getContainerElement,
  newElementWith,
  refreshTextDimensions,
} from "@excalidraw/element";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

type AnyElement = Record<string, any> & { id: string; type: string };

/**
 * The geometry/text update for a text element holding `source` (default: its
 * own `originalText`, which Rust keeps authoritative; wrapped copies are
 * rebuilt from it). Null when the element is not a live text element.
 */
export function measureTextUpdate(
  element: AnyElement,
  elementsMap: Map<string, AnyElement>,
  source?: string,
): Record<string, unknown> | null {
  if (element.type !== "text" || element.isDeleted) {
    return null;
  }
  const container = getContainerElement(element as never, elementsMap as never);
  const text = source ?? element.originalText ?? element.text;
  return (
    (refreshTextDimensions(
      element as never,
      container,
      elementsMap as never,
      text,
    ) as Record<string, unknown> | undefined) ?? null
  );
}

/** Wait (bounded) for the fonts the elements use. */
export async function fontsReady(elements: readonly AnyElement[]) {
  const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
  if (!fonts) {
    return;
  }
  const strings = new Set(elements.map((e) => getFontString(e as never)));
  const wait = Promise.all([...strings].map((f) => fonts.load(f))).then(
    () => fonts.ready,
  );
  await Promise.race([
    wait.catch(() => undefined),
    new Promise((resolve) => setTimeout(resolve, 2000)),
  ]);
}

/** Returns how many elements changed. */
export async function remeasureElements(
  api: ExcalidrawImperativeAPI,
  ids: readonly string[],
): Promise<number> {
  if (ids.length === 0) {
    return 0;
  }
  const wanted = new Set(ids);
  const all = api.getSceneElementsIncludingDeleted() as unknown as AnyElement[];
  const targets = all.filter((e) => wanted.has(e.id) && e.type === "text");
  if (targets.length === 0) {
    return 0;
  }
  await fontsReady(targets);
  // The scene may have changed while the fonts loaded: read it again.
  const current =
    api.getSceneElementsIncludingDeleted() as unknown as AnyElement[];
  const map = new Map(current.map((e) => [e.id, e]));
  const updates = new Map<string, AnyElement>();
  for (const el of current) {
    if (!wanted.has(el.id)) {
      continue;
    }
    const patch = measureTextUpdate(el, map);
    if (patch) {
      updates.set(el.id, newElementWith(el as never, patch as never) as never);
    }
  }
  if (updates.size === 0) {
    return 0;
  }
  api.updateScene({
    elements: current.map((e) => updates.get(e.id) ?? e) as never,
    captureUpdate: "NEVER" as never,
  });
  return updates.size;
}
