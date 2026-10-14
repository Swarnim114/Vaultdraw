import "../colorPicker.css";

/** Segmented buttons (one active). */
export const Segmented = <T extends string | number>({
  options,
  value,
  onChange,
  disabled = false,
}: {
  options: readonly { label: string; val: T }[];
  value: T;
  onChange: (val: T) => void;
  disabled?: boolean;
}) => (
  <div className="vault-segmented-control">
    {options.map((o) => (
      <button
        key={String(o.val)}
        type="button"
        disabled={disabled}
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

/** Toggle switch; `id` lets a SettingRow label target it. */
export const Switch = ({
  id,
  checked,
  onChange,
  label,
  disabled = false,
  title,
}: {
  id?: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  /** Accessible name when no visible label targets the input. */
  label?: string;
  disabled?: boolean;
  title?: string;
}) => (
  <label className="vault-switch" title={title}>
    <input
      id={id}
      type="checkbox"
      role="switch"
      checked={checked}
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onChange={(e) => onChange(e.target.checked)}
    />
    <span className="vault-switch__track" aria-hidden="true">
      <span className="vault-switch__thumb" />
    </span>
  </label>
);

export { ColorSwatches } from "./ColorSwatches";
