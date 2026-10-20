import { useCommandShortcut } from "../commands/useCommandShortcut";
import { HISTORY_COMMAND_IDS } from "../history/historyCommands";
import { useHistoryPanelOpen } from "../history/historyPanelState";

import { IconHistory } from "./Icons";

/**
 * Header button for history.toggle: pressed while the panel shows, and the
 * tooltip shows the command's current key (follows rebinds).
 */
export const HistoryButton = ({ onClick }: { onClick: () => void }) => {
  const key = useCommandShortcut(HISTORY_COMMAND_IDS.toggle);
  const pressed = useHistoryPanelOpen();
  return (
    <button
      type="button"
      className="vault-ibtn"
      onClick={onClick}
      title={key ? `History (${key})` : "History"}
      aria-label="History"
      aria-pressed={pressed}
      data-testid="history-button"
    >
      <IconHistory />
    </button>
  );
};
