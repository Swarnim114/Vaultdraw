import { useRef } from "react";

import { PAPER_STYLES } from "./paperStyles";

import type { KeyboardEvent } from "react";

import type { PaperStyle } from "../../vault/preferences";

type Props = {
  value: PaperStyle;
  onChange: (style: PaperStyle) => void;
  label?: string;
};

/** One-row radio group of icon tiles with labels (settings variant). */
export const PaperTilePicker = ({
  value,
  onChange,
  label = "Background pattern",
}: Props) => {
  const group = useRef<HTMLDivElement>(null);

  // Roving focus: arrows move and select, like a native radio group.
  const onKeyDown = (event: KeyboardEvent) => {
    const step =
      event.key === "ArrowRight" || event.key === "ArrowDown"
        ? 1
        : event.key === "ArrowLeft" || event.key === "ArrowUp"
        ? -1
        : 0;
    if (!step) {
      return;
    }
    event.preventDefault();
    const index = PAPER_STYLES.findIndex((s) => s.id === value);
    const next =
      PAPER_STYLES[(index + step + PAPER_STYLES.length) % PAPER_STYLES.length];
    onChange(next.id);
    group.current
      ?.querySelector<HTMLElement>(`[data-style="${next.id}"]`)
      ?.focus();
  };

  return (
    <div
      ref={group}
      className="paper-tiles"
      role="group"
      aria-label={label}
      onKeyDown={onKeyDown}
    >
      {PAPER_STYLES.map((style) => (
        <button
          key={style.id}
          type="button"
          className="paper-tile"
          data-style={style.id}
          data-checked={value === style.id}
          aria-pressed={value === style.id}
          tabIndex={value === style.id ? 0 : -1}
          onClick={() => onChange(style.id)}
        >
          {style.icon}
          <span className="paper-tile__label">{style.label}</span>
        </button>
      ))}
    </div>
  );
};
