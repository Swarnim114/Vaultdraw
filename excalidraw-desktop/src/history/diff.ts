/**
 * Scene diff for the history preview, from the point of view of someone
 * viewing a VERSION while the CURRENT drawing is the reference.
 *
 * - `added`: ids live in the version but missing or deleted in the current
 *   drawing. Legend "Only in this version" (they come back on restore).
 *   Highlighted in the preview, where they exist.
 * - `removed`: live elements of the current drawing that are not in the
 *   version (never existed there, or deleted there). Legend "Not in this
 *   version" (added since). Returned as elements because the preview scene does
 *   not contain them: the overlay draws ghost outlines from their bounds.
 * - `changed`: same id live on both sides with a different `version` or
 *   `versionNonce` (moved or edited since). Legend "Changed since".
 *
 * isDeleted elements count as absent on both sides. A bound text is counted
 * with its container: it is dropped from a list when its container is already
 * in that list, and an edit of a bound text marks its container as changed
 * (when the container is live on both sides). One pass over each side, O(n).
 */
import type { ExcalidrawElement } from "@excalidraw/element/types";

export interface SceneDiff {
  added: string[];
  removed: ExcalidrawElement[];
  changed: string[];
}

const containerOf = (el: ExcalidrawElement): string | null =>
  el.type === "text"
    ? (el as { containerId?: string | null }).containerId ?? null
    : null;

export const diffScenes = (
  version: readonly ExcalidrawElement[],
  current: readonly ExcalidrawElement[],
): SceneDiff => {
  const live = (list: readonly ExcalidrawElement[]) => {
    const map = new Map<string, ExcalidrawElement>();
    for (const el of list) {
      if (!el.isDeleted) {
        map.set(el.id, el);
      }
    }
    return map;
  };
  const v = live(version);
  const c = live(current);

  const added = new Set<string>();
  const removed = new Map<string, ExcalidrawElement>();
  const changed = new Set<string>();

  for (const [id, el] of v) {
    const now = c.get(id);
    if (!now) {
      added.add(id);
    } else if (
      now.version !== el.version ||
      now.versionNonce !== el.versionNonce
    ) {
      changed.add(id);
    }
  }
  for (const [id, el] of c) {
    if (!v.has(id)) {
      removed.set(id, el);
    }
  }

  // Bound texts count with their container.
  for (const id of [...changed]) {
    const container = containerOf(v.get(id)!);
    if (container && c.has(container) && v.has(container)) {
      changed.delete(id);
      changed.add(container);
    }
  }
  for (const id of [...added]) {
    const container = containerOf(v.get(id)!);
    if (container && added.has(container)) {
      added.delete(id);
    }
  }
  for (const [id, el] of [...removed]) {
    const container = containerOf(el);
    if (container && removed.has(container)) {
      removed.delete(id);
    }
  }

  return {
    added: [...added],
    removed: [...removed.values()],
    changed: [...changed],
  };
};

export const isEmptyDiff = (d: SceneDiff) =>
  !d.added.length && !d.removed.length && !d.changed.length;
