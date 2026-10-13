import type { CSSProperties } from "react";

/** Segmented buttons (one active). */
export const Segmented = <T extends string | number>({
  options,
  value,
  onChange,
}: {
  options: readonly { label: string; val: T }[];
  value: T;
  onChange: (val: T) => void;
}) => (
  <div className="vault-segmented-control">
    {options.map((o) => (
      <button
        key={String(o.val)}
        type="button"
        className={`vault-segmented-btn ${
          value === o.val ? "vault-segmented-btn--active" : ""
        }`}
        onClick={() => onChange(o.val)}
      >
        {o.label}
      </button>
    ))}
  </div>
);

/** Swatch colour as a custom property; the class paints it. */
const swatchStyle = (color: string) =>
  ({ "--vault-swatch": color } as CSSProperties);

/** Preset colour swatches plus a custom colour input. */
export const ColorSwatches = ({
  colors,
  value,
  onChange,
  swatchLabel,
  swatchTitle = (color) => color,
  customValue,
  customTitle,
  disabled = false,
}: {
  colors: readonly string[];
  value: string;
  onChange: (color: string) => void;
  swatchLabel: (color: string) => string;
  swatchTitle?: (color: string) => string;
  /** Value of the custom <input type=color> (must be #rrggbb). */
  customValue: string;
  customTitle: string;
  disabled?: boolean;
}) => (
  <fieldset className="vault-color-options vault-fieldset" disabled={disabled}>
    {colors.map((color) => {
      const transparent = color === "transparent";
      return (
        <button
          key={color}
          type="button"
          className={[
            "vault-color-swatch",
            transparent && "vault-color-swatch--transparent",
            value === color && "vault-color-swatch--active",
          ]
            .filter(Boolean)
            .join(" ")}
          style={transparent ? undefined : swatchStyle(color)}
          onClick={() => onChange(color)}
          title={swatchTitle(color)}
          aria-label={swatchLabel(color)}
        >
          {transparent && (
            <span className="vault-color-swatch__none" aria-hidden="true">
              ∅
            </span>
          )}
        </button>
      );
    })}
    <input
      type="color"
      className="vault-color-input"
      value={customValue}
      onChange={(e) => onChange(e.target.value)}
      title={customTitle}
    />
  </fieldset>
);
