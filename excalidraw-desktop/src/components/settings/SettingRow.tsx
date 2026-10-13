import { IconRefresh } from "../Icons";

import { getSettingSchema } from "./schema";

import type { ReactNode } from "react";

export interface SettingRowProps {
  /** Schema id; label and default description come from schema.ts. */
  id: string;
  /** Replaces the schema description (e.g. a dynamic one). */
  description?: ReactNode;
  /** Shown under the description (paths, status messages). */
  details?: ReactNode;
  /** The control(s). */
  children?: ReactNode;
  /** "row": control beside the text; "block": control below it. */
  layout?: "row" | "block";
  /** Label element targets this control id. */
  htmlFor?: string;
  disabled?: boolean;
  /** Shows a ↺ button that restores the default. */
  onReset?: () => void;
  /** Stored per vault (badge "This vault"). Used from later phases. */
  thisVault?: boolean;
  testId?: string;
  className?: string;
}

export const SettingRow = ({
  id,
  description,
  details,
  children,
  layout = "row",
  htmlFor,
  disabled = false,
  onReset,
  thisVault = false,
  testId,
  className,
}: SettingRowProps) => {
  const schema = getSettingSchema(id);
  const classes = [
    layout === "block" ? "vault-setting-block" : "vault-setting-row",
    disabled && "vault-setting-row--disabled",
    className,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <div className={classes} data-setting-id={id} data-testid={testId}>
      <div className="vault-setting-info">
        <div className="vault-setting-label-line">
          {htmlFor ? (
            <label className="vault-setting-label" htmlFor={htmlFor}>
              {schema.label}
            </label>
          ) : (
            <div className="vault-setting-label">{schema.label}</div>
          )}
          {thisVault && (
            <span
              className="vault-setting-badge"
              title="Stored in this vault's settings"
            >
              This vault
            </span>
          )}
        </div>
        <div className="vault-setting-desc">
          {description ?? schema.description}
        </div>
        {details}
      </div>
      {layout === "block"
        ? children
        : (children || onReset) && (
            <div className="vault-setting-control">
              {children}
              {onReset && (
                <button
                  type="button"
                  className="vault-btn vault-btn--ghost vault-btn--icon vault-setting-reset"
                  onClick={onReset}
                  aria-label={`Reset ${schema.label}`}
                  title="Restore default"
                >
                  <IconRefresh width="14" height="14" />
                </button>
              )}
            </div>
          )}
    </div>
  );
};
