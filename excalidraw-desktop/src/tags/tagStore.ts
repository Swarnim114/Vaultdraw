/**
 * The open vault's tag list, outside React. useVaultTags writes it; the `#`
 * autocomplete and the palette provider read it on demand (no re-render, no
 * extra IPC). Empty when no vault is open.
 */
import type { TagCount } from "./types";

const NO_TAGS: readonly string[] = [];
let current: readonly TagCount[] = [];
let byPath: Readonly<Record<string, readonly string[]>> = {};
const listeners = new Set<() => void>();

export const tagStore = {
  get: (): readonly TagCount[] => current,
  /** Display spellings of the tags on a drawing (stable reference per answer). */
  pathTags: (path: string | null): readonly string[] =>
    (path && byPath[path]) || NO_TAGS,
  set(
    tags: readonly TagCount[],
    paths: Readonly<Record<string, readonly string[]>> = {},
  ) {
    if (tags === current && paths === byPath) {
      return;
    }
    current = tags;
    byPath = paths;
    for (const l of [...listeners]) {
      l();
    }
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};
