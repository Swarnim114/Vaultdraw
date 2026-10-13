import { useEffect, useState } from "react";

import { errorMessage } from "../vault/types";

import type {
  IndexStatus,
  SearchOptions,
  SearchResponse,
  VaultSearch,
} from "./types";

export const SEARCH_DEBOUNCE_MS = 60;
/** While the index is building, results are refreshed at most this often. */
export const BUILDING_REFRESH_MS = 1000;

export interface UseVaultSearchResult {
  response: SearchResponse | null;
  loading: boolean;
  error: string | null;
  status: IndexStatus | null;
}

/**
 * Debounced, latest-wins search. Re-runs the current query when the index
 * becomes ready and (throttled) while it is building so results fill in.
 */
export function useVaultSearch(
  search: VaultSearch | null,
  handle: string | null,
  query: string,
  opts: SearchOptions = {},
): UseVaultSearchResult {
  const { limit, scope } = opts;
  const [response, setResponse] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<IndexStatus | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);

  // Index status: initial value + live updates, with refresh triggers.
  useEffect(() => {
    setStatus(null);
    if (!search || !handle) {
      return;
    }
    let cancelled = false;
    let unsubscribe: (() => void) | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let lastRefresh = Date.now();
    let previous: IndexStatus["state"] | null = null;

    const refresh = () => {
      timer = null;
      lastRefresh = Date.now();
      setRefreshTick((t) => t + 1);
    };
    const onStatus = (next: IndexStatus) => {
      if (cancelled || next.handle !== handle) {
        return;
      }
      const prev = previous;
      previous = next.state;
      setStatus(next);
      if (next.state === "ready" && prev !== null && prev !== "ready") {
        if (timer) {
          clearTimeout(timer);
        }
        refresh();
      } else if (next.state === "building" && !timer) {
        const wait = Math.max(
          0,
          BUILDING_REFRESH_MS - (Date.now() - lastRefresh),
        );
        timer = setTimeout(refresh, wait);
      }
    };

    search
      .subscribe(onStatus)
      .then((off) => {
        if (cancelled) {
          off();
        } else {
          unsubscribe = off;
        }
      })
      .catch(() => {});
    search
      .status(handle)
      .then((s) => {
        // A live event may already have arrived; do not regress it.
        if (!cancelled && previous === null) {
          onStatus(s);
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
      if (timer) {
        clearTimeout(timer);
      }
      unsubscribe?.();
    };
  }, [search, handle]);

  useEffect(() => {
    const trimmed = query.trim();
    // Each run owns its flag; cleanup marks it stale so only the latest wins.
    let stale = false;
    if (!search || !handle || !trimmed) {
      setResponse(null);
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    const timer = setTimeout(() => {
      search
        .search(handle, trimmed, { limit, scope })
        .then((res) => {
          if (!stale) {
            setResponse(res);
            setError(null);
            setLoading(false);
          }
        })
        .catch((cause: unknown) => {
          if (!stale) {
            setError(errorMessage(cause));
            setLoading(false);
          }
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      stale = true;
    };
  }, [search, handle, query, limit, scope, refreshTick]);

  return { response, loading, error, status };
}
