/**
 * The open vault's tag list, outside React. useVaultTags writes it; the `#`
 * autocomplete and the palette provider read it on demand (no re-render, no
 * extra IPC). Empty when no vault is open.
 */
import type { TagCount } from "./types";

let current: readonly TagCount[] = [];
const listeners = new Set<() => void>();

export const tagStore = {
  get: (): readonly TagCount[] => current,
  set(tags: readonly TagCount[]) {
    if (tags === current) {
      return;
    }
    current = tags;
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
