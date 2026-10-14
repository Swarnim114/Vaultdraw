import { useId, useState } from "react";

import {
  BACKGROUND_PATTERN_LIMITS,
  getPatternColors,
  normalizeBackgroundPattern,
} from "@excalidraw/excalidraw/data/backgroundPattern";

import type { BackgroundPattern } from "@excalidraw/excalidraw/data/backgroundPattern";

import { PaperStylePicker } from "./PaperStylePicker";
import { selectPaperStyle } from "./selectPaperStyle";

import "./paper.css";

type Props = {
  value: BackgroundPattern | null;
  onChange: (next: BackgroundPattern | null) => void;
  hideStyle?: boolean;
};

type RangeProps = {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix?: string;
  onChange: (value: number) => void;
};

const NumberRange = ({
  label,
  value,
  min,
  max,
  step,
  suffix,
  onChange,
}: RangeProps) => {
  const id = useId();
  // While the number field is focused it edits a local draft, so partial
  // input ("3" on the way to "30") is not clamped under the user's hands.
  const [draft, setDraft] = useState<string | null>(null);
  const parse = (raw: string) => {
    const next = Number(raw);
    return raw.trim() !== "" && Number.isFinite(next) ? next : null;
  };
  const commitRange = (raw: string) => {
    const next = parse(raw);
    if (next !== null) {
      onChange(next);
    }
  };
  const commitDraft = () => {
    const next = draft === null ? null : parse(draft);
    if (next !== null) {
      onChange(next);
    }
    setDraft(null);
  };
  return (
    <div className="paper-row">
      <label className="paper-row__label" htmlFor={id}>
        {label}
      </label>
      <input
        type="range"
        className="paper-row__range"
        aria-label={`${label} slider`}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => commitRange(event.target.value)}
      />
      <input
        id={id}
        type="number"
        className="paper-row__number"
        min={min}
        max={max}
        step={step}
        value={draft ?? value}
        onChange={(event) => {
          const raw = event.target.value;
          setDraft(raw);
          const next = parse(raw);
          if (next !== null && next >= min && next <= max) {
            onChange(next);
          }
        }}
        onBlur={commitDraft}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            commitDraft();
          } else if (event.key === "Escape" && draft !== null) {
            // Revert the field only; do not let Escape close the dialog.
            event.stopPropagation();
            event.nativeEvent.stopImmediatePropagation();
            setDraft(null);
          }
        }}
      />
      {suffix && <span className="paper-row__suffix">{suffix}</span>}
    </div>
  );
};

export const PaperControls = ({
  value,
  onChange,
  hideStyle = false,
}: Props) => {
  const colorId = useId();
  const emit = (patch: Partial<BackgroundPattern>) => {
    if (value) {
      onChange(normalizeBackgroundPattern({ ...value, ...patch }));
    }
  };
  const limits = BACKGROUND_PATTERN_LIMITS;

  return (
    <div className="paper-controls">
      {!hideStyle && (
        <PaperStylePicker
          value={value?.type ?? null}
          onSelect={(type) => onChange(selectPaperStyle(type, value))}
        />
      )}
      {value && (
        <>
          <NumberRange
            label="Spacing"
            value={value.spacing}
            min={limits.spacing.min}
            max={limits.spacing.max}
            step={1}
            onChange={(spacing) => emit({ spacing })}
          />
          <div className="paper-row">
            <label className="paper-row__label" htmlFor={colorId}>
              Colour
            </label>
            <label className="paper-row__check">
              <input
                type="checkbox"
                checked={value.color === null}
                onChange={(event) =>
                  emit({
                    color: event.target.checked
                      ? null
                      : getPatternColors(value).minor,
                  })
                }
              />
              Auto
            </label>
            <input
              id={colorId}
              type="color"
              className="paper-row__color"
              disabled={value.color === null}
              value={value.color ?? getPatternColors(value).minor}
              onChange={(event) => emit({ color: event.target.value })}
            />
          </div>
          <NumberRange
            label="Opacity"
            value={Math.round(value.opacity * 100)}
            min={limits.opacity.min * 100}
            max={limits.opacity.max * 100}
            step={5}
            suffix="%"
            onChange={(percent) => emit({ opacity: percent / 100 })}
          />
          {(value.type === "grid" || value.type === "graph") && (
            <NumberRange
              label="Major line every"
              value={value.majorEvery}
              min={limits.majorEvery.min}
              max={limits.majorEvery.max}
              step={1}
              onChange={(majorEvery) => emit({ majorEvery })}
            />
          )}
          {value.type === "lines" && (
            <label className="paper-row__check">
              <input
                type="checkbox"
                checked={value.marginLine}
                onChange={(event) => emit({ marginLine: event.target.checked })}
              />
              Margin line
            </label>
          )}
        </>
      )}
    </div>
  );
};
