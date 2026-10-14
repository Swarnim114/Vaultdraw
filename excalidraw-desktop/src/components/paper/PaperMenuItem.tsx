import { MainMenu } from "@excalidraw/excalidraw";

import { PaperStylePicker } from "./PaperStylePicker";
import { selectPaperStyle } from "./selectPaperStyle";
import { usePaperPattern } from "./usePaperPattern";

import "./paper.css";

type Props = { onOpenSettings: () => void };

/** Main-menu row: quick paper style buttons + "Paper settings…". */
export const PaperMenuItem = ({ onOpenSettings }: Props) => {
  const { pattern, setPattern, readOnly, closeMenu } = usePaperPattern();
  if (readOnly) {
    return null;
  }
  return (
    <MainMenu.ItemCustom className="paper-menu">
      <div className="paper-menu__label">Paper</div>
      <PaperStylePicker
        compact
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
      </button>
    </MainMenu.ItemCustom>
  );
};
