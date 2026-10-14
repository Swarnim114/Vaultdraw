import { useId } from "react";

import type { BackgroundPatternType } from "@excalidraw/excalidraw/data/backgroundPattern";

import { PAPER_STYLES } from "./paperStyles";

import "./paper.css";

import type { PaperStyleId } from "./paperStyles";

type Props = {
  /** null = plain. */
  value: BackgroundPatternType | null;
  onSelect: (style: BackgroundPatternType | null) => void;
  compact?: boolean;
  disabled?: boolean;
  label?: string;
};

/** Radio group of the six paper styles, as icon buttons. */
export const PaperStylePicker = ({
  value,
  onSelect,
  compact = false,
  disabled = false,
  label = "Paper style",
}: Props) => {
  const name = useId();
  const current: PaperStyleId = value ?? "plain";
  return (
    <div
      className={`paper-styles${compact ? " paper-styles--compact" : ""}`}
      role="radiogroup"
      aria-label={label}
    >
      {PAPER_STYLES.map((style) => (
        <label
          key={style.id}
          className="paper-style"
          title={style.label}
          data-checked={current === style.id}
        >
          <input
            type="radio"
            name={name}
            className="paper-style__input"
            checked={current === style.id}
            disabled={disabled}
            aria-label={style.label}
            onChange={() => onSelect(style.id === "plain" ? null : style.id)}
          />
          {style.icon}
          {!compact && (
            <span className="paper-style__label">{style.label}</span>
          )}
        </label>
      ))}
    </div>
  );
};
