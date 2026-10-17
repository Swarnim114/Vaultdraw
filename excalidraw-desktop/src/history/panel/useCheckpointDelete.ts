/**
 * Delete-checkpoint flow of the panel: a request (row button or the
 * `history.deleteCheckpoint` command) opens a confirmation; confirming calls
 * the repository and refreshes the list. The command is bound only while the
 * selected version is a checkpoint in a writable vault.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { registerCommandHandlers } from "../../commands/handlerRegistry";
import { errorMessage } from "../../vault/types";
import { HISTORY_COMMAND_IDS } from "../historyCommands";

import type { HistoryRepository, VersionInfo } from "../types";

interface Options {
  repository: HistoryRepository;
  handle: string;
  versions: readonly VersionInfo[];
  selected: VersionInfo | null;
  readOnly: boolean;
  refresh: () => Promise<void>;
  notify: (message: string, notice?: { error?: boolean }) => void;
}

export function useCheckpointDelete(options: Options) {
  const [pending, setPending] = useState<VersionInfo | null>(null);
  const live = useRef(options);
  live.current = options;

  const request = useCallback((id: string) => {
    const v = live.current.versions.find((x) => x.id === id);
    if (v && v.reason === "checkpoint") {
      setPending(v);
    }
  }, []);

  const cancel = useCallback(() => setPending(null), []);

  const confirm = useCallback(async () => {
    const v = pending;
    setPending(null);
    if (!v) {
      return;
    }
    const { repository, handle, refresh, notify } = live.current;
    try {
      await repository.deleteCheckpoint(handle, v.id);
      notify("Checkpoint deleted");
    } catch (cause) {
      notify(errorMessage(cause), { error: true });
    }
    await refresh();
  }, [pending]);

  const bound = !options.readOnly && options.selected?.reason === "checkpoint";
  const selectedId = options.selected?.id ?? null;
  useEffect(() => {
    if (!bound || !selectedId) {
      return;
    }
    return registerCommandHandlers({
      [HISTORY_COMMAND_IDS.deleteCheckpoint]: () => request(selectedId),
    });
  }, [bound, selectedId, request]);

  return { pending, confirming: pending !== null, request, cancel, confirm };
}
