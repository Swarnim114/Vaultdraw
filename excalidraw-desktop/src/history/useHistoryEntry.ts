/**
 * UI entry points for the History panel (header button, canvas main menu, a
 * drawing's row menu). They only dispatch history.toggle, the command the
 * palette and Mod+Shift+H run, so the lazy panel chunk is never pulled in here.
 */
import { useCallback, useMemo, useRef } from "react";

import { useRunOnDrawing } from "../commands/useRunOnDrawing";

import { HISTORY_COMMAND_IDS } from "./historyCommands";
import { isHistoryPanelOpen } from "./historyPanelState";

type Run = (id: string) => boolean;

export interface HistoryEntry {
  /** history.toggle (shows or hides the panel of the open drawing). */
  toggleHistory(): void;
  /**
   * Shows the History panel of `path`, opening that drawing first when it is
   * not the active one. Never closes an open panel.
   */
  showHistory(path: string): Promise<void>;
}

export function useHistoryEntry(
  activePath: string | null,
  openDrawing: (path: string) => Promise<boolean>,
  run: Run,
): HistoryEntry {
  const live = useRef(run);
  live.current = run;
  const runOnDrawing = useRunOnDrawing(activePath, openDrawing);

  const toggleHistory = useCallback(() => {
    live.current(HISTORY_COMMAND_IDS.toggle);
  }, []);

  const showHistory = useCallback(
    (path: string) =>
      runOnDrawing(path, () => {
        if (!isHistoryPanelOpen()) {
          live.current(HISTORY_COMMAND_IDS.toggle);
        }
      }),
    [runOnDrawing],
  );

  return useMemo(
    () => ({ toggleHistory, showHistory }),
    [toggleHistory, showHistory],
  );
}
