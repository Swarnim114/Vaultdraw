/**
 * `history_status` for one vault: read once when `active` turns on and again
 * on `refresh()` (after an action or a history-change event). No polling.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import type { HistoryRepository, HistoryStatus } from "./types";

export function useHistoryStatus(
  repository: HistoryRepository,
  handle: string | null,
  active = true,
): { status: HistoryStatus | null; refresh: () => Promise<void> } {
  const [status, setStatus] = useState<HistoryStatus | null>(null);
  const generation = useRef(0);

  const refresh = useCallback(async () => {
    const mine = ++generation.current;
    if (!handle) {
      setStatus(null);
      return;
    }
    try {
      const next = await repository.status(handle);
      if (mine === generation.current) {
        setStatus(next);
      }
    } catch {
      // Status is advisory: a failed read just hides what depends on it.
      if (mine === generation.current) {
        setStatus(null);
      }
    }
  }, [repository, handle]);

  useEffect(() => {
    if (!active) {
      return;
    }
    void refresh();
    const token = generation;
    return () => {
      token.current++;
    };
  }, [active, refresh]);

  return { status, refresh };
}
