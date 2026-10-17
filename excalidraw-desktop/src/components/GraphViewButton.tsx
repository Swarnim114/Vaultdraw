import { GRAPH_COMMAND_IDS } from "../commands/graphCommands";
import { useCommandShortcut } from "../commands/useCommandShortcut";

import { IconGraph } from "./Icons";

interface Props {
  onClick: () => void;
  /** The graph view is showing (the button then closes it, as graph.open does). */
  pressed?: boolean;
  win?: Window | null;
}

/** Navigator toolbar button for graph.open; the tooltip shows its current key. */
export const GraphViewButton = ({ onClick, pressed = false, win }: Props) => {
  const key = useCommandShortcut(GRAPH_COMMAND_IDS.open, win);
  return (
    <button
      type="button"
      className="vault-btn vault-btn--ghost vault-btn--icon"
      onClick={onClick}
      title={key ? `Graph view (${key})` : "Graph view"}
      aria-label="Graph view"
      aria-pressed={pressed}
    >
      <IconGraph />
    </button>
  );
};
