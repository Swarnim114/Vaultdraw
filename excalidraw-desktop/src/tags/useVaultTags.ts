import { startTransition, useEffect, useState } from "react";

import { tagStore } from "./tagStore";

import type { VaultSearch } from "../search/types";
import type { TagCount } from "./types";

export const TAGS_REFRESH_DEBOUNCE_MS = 300;

export interface UseVaultTagsResult {
  tags: TagCount[];
  byPath: Record<string, string[]>;
  loading: boolean;
}

type TagsData = Omit<UseVaultTagsResult, "loading">;

const EMPTY: TagsData = { tags: [], byPath: {} };

const sameList = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((v, i) => v === b[i]);

/** True when two tag answers would render the same. */
export const sameTags = (a: TagsData, b: TagsData) => {
  if (
    a.tags.length !== b.tags.length ||
    a.tags.some(
      (t, i) =>
        t.tag !== b.tags[i].tag ||
        t.display !== b.tags[i].display ||
        t.count !== b.tags[i].count,
    )
  ) {
    return false;
  }
  const paths = Object.keys(a.byPath);
  return (
    paths.length === Object.keys(b.byPath).length &&
    paths.every((p) => b.byPath[p] && sameList(a.byPath[p], b.byPath[p]))
  );
};

/**
 * Vault tags: fetched on mount/handle change and refetched (debounced,
 * latest wins) on every index status event. Failures keep the old data.
 */
export function useVaultTags(
  search: VaultSearch | null,
  handle: string | null,
): UseVaultTagsResult {
  const [data, setData] = useState<TagsData>(EMPTY);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setData(EMPTY);
    setLoading(false);
    tagStore.set(EMPTY.tags);
    if (!search || !handle) {
      return;
    }
    let cancelled = false;
    let seq = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let current = EMPTY;
    let showsLoading = false;

    // Only the first fetch shows as loading, and an unchanged answer keeps the
    // old object: refetches after every index change must not re-render the
    // whole navigator tree.
    const load = (initial: boolean) => {
      const mine = ++seq;
      if (initial) {
        showsLoading = true;
        setLoading(true);
      }
      search
        .tags(handle)
        .then((res) => {
          if (!cancelled && mine === seq) {
            const next = { tags: res.tags, byPath: res.byPath };
            if (!sameTags(current, next)) {
              current = next;
              tagStore.set(next.tags);
              // Refetches follow index changes: never block a keystroke render.
              startTransition(() => setData(next));
            }
          }
        })
        .catch(() => {})
        .finally(() => {
          if (showsLoading && !cancelled && mine === seq) {
            showsLoading = false;
            setLoading(false);
          }
        });
    };
    const schedule = () => {
      if (timer) {
        clearTimeout(timer);
      }
      timer = setTimeout(() => {
        timer = null;
        load(false);
      }, TAGS_REFRESH_DEBOUNCE_MS);
    };

    let unsubscribe: (() => void) | null = null;
    search
      .subscribe((status) => {
        if (!cancelled && status.handle === handle) {
          schedule();
        }
      })
      .then((off) => {
        if (cancelled) {
          off();
        } else {
          unsubscribe = off;
        }
      })
      .catch(() => {});
    load(true);

    return () => {
      cancelled = true;
      if (timer) {
        clearTimeout(timer);
      }
      unsubscribe?.();
    };
  }, [search, handle]);

  return { ...data, loading };
}
