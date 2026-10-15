import { useRef } from "react";

import { PATTERN_MARGIN_COLOR } from "@excalidraw/excalidraw/data/backgroundPattern";
import {
  PAPER_THEME_COLORS,
  type PaperTheme,
} from "@excalidraw/excalidraw/data/pageSetup";

import { PAPER_THEME_OPTIONS } from "./pageOptions";

import type { KeyboardEvent, ReactNode } from "react";

const RULES = [9, 14, 19];

/** A tiny sheet: fill, optional ruled lines and margin, like the paper. */
const Sheet = ({
  fill,
  rule,
  margin,
}: {
  fill: string;
  rule: string;
  margin?: string;
}) => (
  <svg viewBox="0 0 26 26" aria-hidden="true">
    <rect
      x="4.5"
      y="2.5"
      width="17"
      height="21"
      rx="1.5"
      fill={fill}
      stroke="currentColor"
      strokeOpacity="0.45"
    />
    {RULES.map((y) => (
      <path key={y} d={`M5 ${y}h16`} stroke={rule} strokeWidth="1" />
    ))}
    {margin && <path d="M8.5 3v20" stroke={margin} strokeWidth="1" />}
  </svg>
);

const SHEETS: Record<PaperTheme, ReactNode> = {
  normal: <Sheet fill={PAPER_THEME_COLORS.normal.background} rule="#ced4da" />,
  oldSchool: (
    <Sheet
      fill={PAPER_THEME_COLORS.oldSchool.background}
      rule={PAPER_THEME_COLORS.oldSchool.patternColor!}
      margin={PATTERN_MARGIN_COLOR}
    />
  ),
  match: <Sheet fill="var(--vault-bg)" rule="var(--vault-border)" />,
};

type Props = {
  value: PaperTheme;
  onChange: (theme: PaperTheme) => void;
};

/** Paper theme as icon tiles, like the Background Pattern picker. */
export const PaperThemeTiles = ({ value, onChange }: Props) => {
  const group = useRef<HTMLDivElement>(null);

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
    const list = PAPER_THEME_OPTIONS;
    const index = list.findIndex((o) => o.val === value);
    const next = list[(index + step + list.length) % list.length];
    onChange(next.val);
    group.current
      ?.querySelector<HTMLElement>(`[data-paper-theme="${next.val}"]`)
      ?.focus();
  };

  return (
    <div
      ref={group}
      className="paper-tiles paper-tiles--themes"
      role="group"
      aria-label="Paper theme"
      onKeyDown={onKeyDown}
    >
      {PAPER_THEME_OPTIONS.map((o) => (
        <button
          key={o.val}
          type="button"
          className="paper-tile"
          data-paper-theme={o.val}
          data-checked={value === o.val}
          aria-pressed={value === o.val}
          tabIndex={value === o.val ? 0 : -1}
          onClick={() => onChange(o.val)}
        >
          {SHEETS[o.val]}
          <span className="paper-tile__label">{o.label}</span>
        </button>
      ))}
    </div>
  );
};
