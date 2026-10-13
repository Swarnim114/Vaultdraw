import { IconAlert, IconCheck, IconPlus, IconSidebar } from "./Icons";

import type { SaveStatus, VaultInfo } from "../vault/types";

interface VaultHeaderProps {
  vault: VaultInfo | null;
  activePath: string | null;
  saveStatus: SaveStatus;
  saveError?: string | null;
  recoveryCount?: number;
  navigatorCollapsed: boolean;
  onToggleNavigator: () => void;
  onNewDrawing: () => void;
  onOpenConflict: () => void;
  onOpenRecovery: () => void;
  onSave?: () => void;
}

export const VaultHeader = ({
  vault,
  activePath,
  saveStatus,
  saveError,
  recoveryCount = 0,
  navigatorCollapsed,
  onToggleNavigator,
  onNewDrawing,
  onOpenConflict,
  onOpenRecovery,
  onSave,
}: VaultHeaderProps) => {
  if (!vault) {
    return null;
  }

  const pathParts = activePath ? activePath.split("/") : [];
  const fileName = pathParts.pop();

  return (
    <header className="vault-header" role="banner">
      <div className="vault-header__left">
        <nav className="vault-breadcrumbs" aria-label="Breadcrumb">
          <span className="vault-breadcrumbs__item" title={vault.name}>
            {vault.name}
          </span>
          {pathParts.map((part, index) => (
            <span
              key={index}
              style={{ display: "inline-flex", alignItems: "center" }}
            >
              <span className="vault-breadcrumbs__sep">/</span>
              <span className="vault-breadcrumbs__item" title={part}>
                {part}
              </span>
            </span>
          ))}
          {fileName && (
            <span style={{ display: "inline-flex", alignItems: "center" }}>
              <span className="vault-breadcrumbs__sep">/</span>
              <span
                className="vault-breadcrumbs__item vault-breadcrumbs__item--active"
                title={fileName}
              >
                {fileName.replace(/\.excalidraw$/i, "")}
              </span>
            </span>
          )}
        </nav>
      </div>

      <div className="vault-header__center">
        {vault.readOnly && (
          <span
            className="vault-badge vault-badge--readonly"
            title="This vault is open read-only because it is not writable or another app instance owns its lock"
          >
            Read-Only
          </span>
        )}

        {recoveryCount > 0 && (
          <button
            type="button"
            className="vault-badge vault-badge--recovery"
            onClick={onOpenRecovery}
            title={`${recoveryCount} recoverable snapshot(s) found. Click to review.`}
          >
            {recoveryCount} Recovery Snapshot{recoveryCount > 1 ? "s" : ""}
          </button>
        )}

        {activePath && (
          <>
            {saveStatus === "saved" && (
              <span
                className="vault-status vault-status--saved"
                title="All edits saved to disk"
                role="status"
              >
                <IconCheck />
                <span>Saved</span>
              </span>
            )}
            {saveStatus === "dirty" && (
              <button
                type="button"
                className="vault-status vault-status--dirty"
                onClick={onSave}
                disabled={!onSave || vault.readOnly}
                title="Unsaved changes — click or press Ctrl+S / Cmd+S to save now"
                aria-label="Save drawing"
              >
                <span className="vault-status__dot" />
                <span>Unsaved</span>
              </button>
            )}
            {saveStatus === "saving" && (
              <span
                className="vault-status vault-status--saving"
                title="Writing atomic update to disk..."
                role="status"
              >
                <span className="vault-spinner" />
                <span>Saving…</span>
              </span>
            )}
            {saveStatus === "conflict" && (
              <button
                type="button"
                className="vault-badge vault-badge--conflict"
                onClick={onOpenConflict}
                title={
                  saveError ??
                  "File changed externally. Click to resolve conflict."
                }
              >
                <IconAlert />
                <span>Conflict</span>
              </button>
            )}
            {saveStatus === "error" && (
              <button
                type="button"
                className="vault-badge vault-badge--error"
                onClick={onOpenConflict}
                title={saveError ?? "Error saving file. Click for details."}
              >
                <IconAlert />
                <span>Save Error</span>
              </button>
            )}
          </>
        )}
      </div>

      <div className="vault-header__right">
        {!vault.readOnly && (
          <button
            type="button"
            className="vault-btn vault-btn--ghost vault-btn--icon"
            onClick={onNewDrawing}
            title="New drawing in the current folder"
            aria-label="New Drawing"
          >
            <IconPlus />
          </button>
        )}

        <button
          type="button"
          className="vault-btn vault-btn--ghost vault-btn--icon"
          onClick={onToggleNavigator}
          title={navigatorCollapsed ? "Show Navigator" : "Hide Navigator"}
          aria-label={navigatorCollapsed ? "Show Navigator" : "Hide Navigator"}
          aria-expanded={!navigatorCollapsed}
        >
          <IconSidebar />
        </button>
      </div>
    </header>
  );
};
