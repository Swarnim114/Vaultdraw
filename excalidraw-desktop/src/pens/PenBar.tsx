import "./pens.css";

import type { PenPreset } from "./penPresets";

interface Props {
  presets: readonly PenPreset[];
  /** Display text of each pen's shortcut ("" or missing = none). */
  shortcuts?: readonly string[];
  active: number | null;
  onSelect: (index: number) => void;
  onOpenSettings?: () => void;
}

/** Pen chips shown under the top toolbar while the freedraw tool is active. */
export function PenBar({
  presets,
  shortcuts = [],
  active,
  onSelect,
  onOpenSettings,
}: Props) {
  return (
    <div className="pen-bar" role="toolbar" aria-label="Pens">
      {presets.map((preset, i) => {
        const shortcut = shortcuts[i];
        return (
          <button
            key={`${i}-${preset.name}`}
            type="button"
            className="pen-bar__chip"
            aria-label={preset.name}
            aria-pressed={active === i}
            title={shortcut ? `${preset.name} (${shortcut})` : preset.name}
            onClick={() => onSelect(i)}
          >
            <span
              className="pen-bar__swatch"
              style={{
                background: preset.color,
                opacity: preset.opacity / 100,
              }}
            />
            <span className="pen-bar__name">{preset.name}</span>
          </button>
        );
      })}
      {onOpenSettings && (
        <button
          type="button"
          className="pen-bar__chip pen-bar__settings"
          aria-label="Pens settings"
          title="Pens settings"
          onClick={onOpenSettings}
        >
          Settings
        </button>
      )}
    </div>
  );
}
