import { MainMenu } from "@excalidraw/excalidraw";

import { paperCommandId } from "../../commands/editorCommands";
import { useCommandShortcutLookup } from "../../commands/useCommandShortcut";

import { PaperStylePicker } from "./PaperStylePicker";
import { selectPaperStyle } from "./selectPaperStyle";
import { usePaperPattern } from "./usePaperPattern";

import "./paper.css";

type Props = { onOpenSettings: () => void };

/** Main-menu row: quick paper style buttons + "Paper settings…". */
export const PaperMenuItem = ({ onOpenSettings }: Props) => {
  const shortcut = useCommandShortcutLookup();
  const { pattern, setPattern, readOnly, closeMenu } = usePaperPattern();
  if (readOnly) {
    return null;
  }
  return (
    <MainMenu.ItemCustom className="paper-menu">
      <div className="paper-menu__label">Paper</div>
      <PaperStylePicker
        compact
        shortcuts={(id) => shortcut(paperCommandId(id))}
        value={pattern?.type ?? null}
        onSelect={(type) => setPattern(selectPaperStyle(type, pattern))}
      />
      <button
        type="button"
        className="paper-menu__settings"
        onClick={() => {
          closeMenu();
          onOpenSettings();
        }}
      >
        Paper settings…
        {shortcut("paper.settings") && (
          <kbd className="paper-menu__key">{shortcut("paper.settings")}</kbd>
        )}
      </button>
    </MainMenu.ItemCustom>
  );
};
