import { useEffect, useState } from "react";

import type { VaultSearch } from "../search/types";
import type { TagCount } from "./types";

export const TAGS_REFRESH_DEBOUNCE_MS = 300;

export interface UseVaultTagsResult {
  tags: TagCount[];
  byPath: Record<string, string[]>;
  loading: boolean;
}

const EMPTY: Omit<UseVaultTagsResult, "loading"> = { tags: [], byPath: {} };

/**
 * Vault tags: fetched on mount/handle change and refetched (debounced,
 * latest wins) on every index status event. Failures keep the old data.
 */
export function useVaultTags(
  search: VaultSearch | null,
  handle: string | null,
): UseVaultTagsResult {
  const [data, setData] = useState(EMPTY);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setData(EMPTY);
    setLoading(false);
    if (!search || !handle) {
      return;
    }
    let cancelled = false;
    let seq = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const load = () => {
      const mine = ++seq;
      setLoading(true);
      search
        .tags(handle)
        .then((res) => {
          if (!cancelled && mine === seq) {
            setData({ tags: res.tags, byPath: res.byPath });
          }
        })
        .catch(() => {})
        .finally(() => {
          if (!cancelled && mine === seq) {
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
        load();
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
    load();

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
