/**
 * Building blocks of the Tools settings page: tool icons, the panel header
 * (icon + name, actions on the right) and label-left / control-right rows.
 * Every section (a styled tool, the pens, the laser) is built from these.
 */
import { IconRefresh } from "../../Icons";
import { TOOLS_SECTION_LABELS, type ToolsSection } from "../schema";

import type { ReactNode } from "react";

const icon = (children: ReactNode) => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.75"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {children}
  </svg>
);

/** Same shapes as the editor's toolbar, drawn in the app's icon style. */
export const TOOL_ICONS: Record<ToolsSection, ReactNode> = {
  rectangle: icon(<rect x="4" y="6" width="16" height="12" rx="2" />),
  diamond: icon(<path d="M12 3.5 20.5 12 12 20.5 3.5 12Z" />),
  ellipse: icon(<ellipse cx="12" cy="12" rx="8.5" ry="6.5" />),
  arrow: icon(<path d="M5 19 19 5M10 5h9v9" />),
  line: icon(<path d="M4 20 20 4" />),
  text: icon(<path d="M5 6V4.5h14V6M12 4.5v15M9 19.5h6" />),
  pen: icon(
    <>
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z" />
      <path d="m14.5 5.5 3 3" />
    </>,
  ),
  laser: icon(
    <>
      <circle cx="17" cy="7" r="2.5" />
      <path d="M14.5 9.5 4 20M19.5 2.5v1M21.5 7h-1M12.5 7h1M17 11.5v1" />
    </>,
  ),
};

/** Section heading: icon and name, then actions aligned right. */
export const ToolsPanelHeader = ({
  section,
  children,
}: {
  section: ToolsSection;
  children?: ReactNode;
}) => (
  <div className="vault-tools-header">
    <span className="vault-tools-header__icon">{TOOL_ICONS[section]}</span>
    <h3 className="vault-tools-header__title">
      {TOOLS_SECTION_LABELS[section]}
    </h3>
    <div className="vault-tools-header__actions">{children}</div>
  </div>
);

/** Ghost "Reset" button with the shared restore icon. */
export const ResetButton = ({
  label,
  title,
  disabled = false,
  onClick,
}: {
  /** Accessible name, e.g. "Reset Arrow". */
  label: string;
  title: string;
  disabled?: boolean;
  onClick: () => void;
}) => (
  <button
    type="button"
    className="vault-btn vault-btn--ghost vault-btn--sm vault-tools-reset"
    aria-label={label}
    title={title}
    disabled={disabled}
    onClick={onClick}
  >
    <IconRefresh width="12" height="12" aria-hidden="true" />
    Reset
  </button>
);

/** One setting: label on the left, control on the right, fixed height. */
export const ToolsRow = ({
  label,
  hint,
  htmlFor,
  testId,
  children,
}: {
  label: string;
  /** Small muted text after the label (units, ranges). */
  hint?: string;
  htmlFor?: string;
  testId?: string;
  children: ReactNode;
}) => (
  <div className="vault-tools-row" data-testid={testId}>
    {htmlFor ? (
      <label className="vault-tools-row__label" htmlFor={htmlFor}>
        {label}
        {hint && <span className="vault-tools-row__hint">{hint}</span>}
      </label>
    ) : (
      <span className="vault-tools-row__label">
        {label}
        {hint && <span className="vault-tools-row__hint">{hint}</span>}
      </span>
    )}
    <div className="vault-tools-row__control">{children}</div>
  </div>
);

/** A section's card: header, preview, rows. Search results reuse it. */
export const ToolsPanel = ({
  section,
  settingId,
  testId,
  children,
}: {
  section: ToolsSection;
  /** Schema id of the row this panel shows (search, tests). */
  settingId?: string;
  testId?: string;
  children: ReactNode;
}) => (
  <div
    className="vault-tools-panel"
    data-section={section}
    data-setting-id={settingId}
    data-testid={testId}
  >
    {children}
  </div>
);
