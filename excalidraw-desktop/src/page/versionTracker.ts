/**
 * Remembers the version of every element it has seen, so a pass over the
 * scene can tell what was added or changed since the last pass.
 */
import type { ExcalidrawElement } from "@excalidraw/element/types";

export class VersionTracker {
  private versions = new Map<string, number>();

  /** Record every element without reporting changes (opening a drawing). */
  seed(elements: readonly ExcalidrawElement[]): void {
    this.versions.clear();
    for (const element of elements) {
      this.versions.set(element.id, element.version);
    }
  }

  /** Elements added or changed since they were last recorded; records them. */
  diff(elements: readonly ExcalidrawElement[]): ExcalidrawElement[] {
    const changed: ExcalidrawElement[] = [];
    const versions = this.versions;
    for (let i = 0; i < elements.length; i++) {
      const element = elements[i];
      if (versions.get(element.id) !== element.version) {
        versions.set(element.id, element.version);
        changed.push(element);
      }
    }
    if (versions.size > elements.length * 2 + 64) {
      this.seed(elements);
    }
    return changed;
  }

  /** Record `elements` (e.g. our own corrections) as seen. */
  mark(elements: readonly ExcalidrawElement[]): void {
    for (const element of elements) {
      this.versions.set(element.id, element.version);
    }
  }
}
