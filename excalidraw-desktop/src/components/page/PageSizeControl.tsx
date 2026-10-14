import { useId } from "react";

import {
  PAGE_LIMITS,
  type PageSetup,
  type PageSize,
} from "@excalidraw/excalidraw/data/pageSetup";

import "../paper/paper.css";

import { SIZE_OPTIONS } from "./pageOptions";

import "./page.css";

type Props = {
  size: PageSize;
  width: number;
  height: number;
  onChange: (changes: Partial<PageSetup>) => void;
  disabled?: boolean;
};

const SideInput = ({
  label,
  value,
  disabled,
  onCommit,
}: {
  label: string;
  value: number;
  disabled?: boolean;
  onCommit: (value: number) => void;
}) => {
  const commit = (raw: string) => {
    const next = Number(raw);
    if (raw.trim() !== "" && Number.isFinite(next) && next !== value) {
      onCommit(next);
    }
  };
  return (
    <label className="page-size__side">
      {label}
      {/* Uncontrolled + keyed: partial typing is not clamped under the cursor. */}
      <input
        key={value}
        type="number"
        className="paper-row__number"
        min={PAGE_LIMITS.side.min}
        max={PAGE_LIMITS.side.max}
        defaultValue={value}
        disabled={disabled}
        onBlur={(event) => commit(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            commit(event.currentTarget.value);
          }
        }}
      />
    </label>
  );
};

/** Size preset select, plus width / height (px) inputs for "Custom". */
export const PageSizeControl = ({
  size,
  width,
  height,
  onChange,
  disabled,
}: Props) => {
  const id = useId();
  return (
    <div className="page-size">
      <select
        id={id}
        className="vault-input"
        aria-label="Page size"
        value={size}
        disabled={disabled}
        onChange={(event) =>
          onChange({
            size: event.target.value as PageSize,
            // Custom starts from the current page's size.
            ...(event.target.value === "custom" && { width, height }),
          })
        }
      >
        {SIZE_OPTIONS.map((o) => (
          <option key={o.val} value={o.val}>
            {o.label}
          </option>
        ))}
      </select>
      {size === "custom" && (
        <>
          <SideInput
            label="Width"
            value={width}
            disabled={disabled}
            onCommit={(next) => onChange({ width: next })}
          />
          <SideInput
            label="Height"
            value={height}
            disabled={disabled}
            onCommit={(next) => onChange({ height: next })}
          />
          <span className="paper-row__suffix">px</span>
        </>
      )}
    </div>
  );
};
