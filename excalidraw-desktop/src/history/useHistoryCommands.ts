/**
 * Binds the app-level History command handlers (the ones that exist whenever a
 * vault is open). Handlers that only make sense while the panel is mounted bind
 * themselves with registerCommandHandlers in the panel.
 */
import { useEffect, useRef } from "react";

import { registerCommandHandlers } from "../commands/handlerRegistry";

import { HISTORY_COMMAND_IDS } from "./historyCommands";

export interface HistoryActions {
  checkpoint(): void;
  toggle(): void;
  timeTravel(): void;
}

export function useHistoryCommands(actions: HistoryActions): void {
  const live = useRef(actions);
  live.current = actions;
  useEffect(
    () =>
      registerCommandHandlers({
        [HISTORY_COMMAND_IDS.checkpoint]: () => live.current.checkpoint(),
        [HISTORY_COMMAND_IDS.toggle]: () => live.current.toggle(),
        [HISTORY_COMMAND_IDS.timeTravel]: () => live.current.timeTravel(),
      }),
    [],
  );
}
