import type { ThemeMode, ThemeVariant } from "../theme";
import type { ThemeEntry } from "../theme/registry";

const PREVIEW_MODES: readonly ThemeMode[] = ["dark", "light"];
const GENERATED_NOTE =
  /^(dark|light): generated from the (dark|light) variant$/;

const ThemeHalf = ({
  variant,
  mode,
  generated,
}: {
  variant: ThemeVariant;
  mode: ThemeMode;
  generated: boolean;
}) => {
  const t = variant.terminal.normal;
  return (
    <div
      className="vault-theme-card__half"
      data-mode={mode}
      style={{ backgroundColor: variant.mSurface, color: variant.mOnSurface }}
    >
      <div
        className="vault-theme-card__bar"
        style={{ backgroundColor: variant.mSurfaceVariant }}
      />
      <div
        className="vault-theme-card__line"
        style={{ backgroundColor: variant.mOnSurface }}
      />
      <div
        className="vault-theme-card__line vault-theme-card__line--short"
        style={{ backgroundColor: variant.mOnSurfaceVariant }}
      />
      <div className="vault-theme-card__swatches">
        <span
          className="vault-theme-card__pill"
          style={{ backgroundColor: variant.mPrimary }}
        />
        {[t.red, t.yellow, t.green, t.blue].map((color, i) => (
          <span
            key={i}
            className="vault-theme-card__dot"
            style={{ backgroundColor: color }}
          />
        ))}
      </div>
      {generated && (
        <span
          className="vault-theme-card__auto"
          style={{
            color: variant.mOnSurfaceVariant,
            borderColor: variant.mOutline,
          }}
          title={`The ${mode} variant is generated from the other one`}
        >
          auto
        </span>
      )}
    </div>
  );
};

export interface ThemePickerProps {
  themes: readonly ThemeEntry[];
  selectedKey: string;
  onSelect: (entry: ThemeEntry) => void;
}

/** Grid of theme cards, each previewing its dark and light variants. */
export const ThemePicker = ({
  themes,
  selectedKey,
  onSelect,
}: ThemePickerProps) => (
  <div
    className="vault-theme-grid"
    role="radiogroup"
    aria-label="Colour theme"
    data-testid="theme-picker"
  >
    {themes.map((entry) => {
      const selected = entry.key === selectedKey;
      const { theme } = entry;
      // Built-ins can carry harmless notes; only user files show them.
      // The "auto" badge already says a variant was generated.
      const warnings =
        entry.source === "user"
          ? entry.warnings.filter((w) => !GENERATED_NOTE.test(w))
          : [];
      return (
        <button
          key={`${entry.source}:${entry.key}`}
          type="button"
          role="radio"
          aria-checked={selected}
          aria-label={theme.name}
          data-theme-key={entry.key}
          className={`vault-theme-card ${
            selected ? "vault-theme-card--selected" : ""
          }`}
          title={entry.path ?? theme.author ?? theme.name}
          onClick={() => onSelect(entry)}
        >
          <div className="vault-theme-card__preview">
            {PREVIEW_MODES.map((mode) => (
              <ThemeHalf
                key={mode}
                mode={mode}
                variant={theme[mode]}
                generated={theme.generated[mode]}
              />
            ))}
          </div>
          <div className="vault-theme-card__meta">
            <span className="vault-theme-card__name">{theme.name}</span>
            {entry.source === "user" && (
              <span className="vault-theme-card__tag">
                {entry.overridesBuiltin ? "Custom override" : "Custom"}
              </span>
            )}
          </div>
          {warnings.length > 0 && (
            <div
              className="vault-theme-card__warning"
              title={warnings.join("\n")}
            >
              {warnings.length === 1
                ? warnings[0]
                : `${warnings[0]} (+${warnings.length - 1} more)`}
            </div>
          )}
        </button>
      );
    })}
  </div>
);
