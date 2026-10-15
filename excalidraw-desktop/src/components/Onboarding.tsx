import { isTauriAvailable } from "../vault/DesktopVaultRepository";

import {
  IconAlert,
  IconClose,
  IconDrawing,
  IconFolder,
  IconPlus,
} from "./Icons";

interface OnboardingProps {
  recentVaults: string[];
  lastVaultPath?: string | null;
  onOpenVault: () => void | Promise<void>;
  onCreateVault: () => void | Promise<void>;
  onSelectRecent: (vaultPath: string) => void | Promise<void>;
  onRemoveRecent: (vaultPath: string) => void;
  error?: string | null;
  loading?: boolean;
  ownerWindow?: Window | null;
}

export const Onboarding = ({
  recentVaults,
  lastVaultPath,
  onOpenVault,
  onCreateVault,
  onSelectRecent,
  onRemoveRecent,
  error,
  loading = false,
  ownerWindow,
}: OnboardingProps) => {
  const tauriActive = isTauriAvailable(ownerWindow);

  return (
    <div className="vault-onboarding">
      {/* Empty title-bar strip so the window can be dragged before a vault opens. */}
      <div className="vault-titlebar-drag" data-tauri-drag-region />
      <div className="vault-onboarding__card">
        <div className="vault-onboarding__logo" aria-hidden="true">
          <IconDrawing width={28} height={28} />
        </div>
        <h1 className="vault-onboarding__title">Vaultdraw</h1>
        <p className="vault-onboarding__desc">
          Your offline, local canvas notebook. All drawings are standard files
          stored inside normal folders directly on your filesystem.
        </p>

        {!tauriActive && (
          <div className="vault-banner vault-banner--warning">
            <span style={{ flexShrink: 0, marginTop: "2px" }}>
              <IconAlert />
            </span>
            <div>
              <strong>Web Browser Preview Notice</strong>
              <div style={{ marginTop: "4px" }}>
                Tauri desktop backend is not active in this browser tab. Native
                filesystem folders, atomic saving, and background watching
                require running inside the Vaultdraw desktop application.
              </div>
            </div>
          </div>
        )}

        {error && (
          <div
            className="vault-banner vault-banner--warning"
            style={{
              backgroundColor: "var(--vault-danger-bg)",
              color: "var(--vault-danger)",
              borderColor: "var(--vault-danger-border)",
            }}
          >
            {error}
          </div>
        )}

        <div className="vault-onboarding__actions">
          <button
            type="button"
            className="vault-btn vault-btn--primary"
            onClick={() => void onOpenVault()}
            disabled={loading}
          >
            <IconFolder />
            <span>Open Vault Folder</span>
          </button>
          <button
            type="button"
            className="vault-btn"
            onClick={() => void onCreateVault()}
            disabled={loading}
          >
            <IconPlus />
            <span>Create New Vault</span>
          </button>
        </div>

        {recentVaults.length > 0 && (
          <div className="vault-onboarding__recent">
            <div className="vault-onboarding__recent-title">Recent Vaults</div>
            <div className="vault-onboarding__recent-list">
              {recentVaults.map((vaultPath) => (
                <div
                  key={vaultPath}
                  className="vault-onboarding__recent-item"
                  onClick={() => void onSelectRecent(vaultPath)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      void onSelectRecent(vaultPath);
                    }
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                      minWidth: 0,
                    }}
                  >
                    <IconFolder />
                    <span className="vault-onboarding__recent-path">
                      {vaultPath}
                    </span>
                    {vaultPath === lastVaultPath && (
                      <span
                        className="vault-badge vault-badge--saved"
                        style={{ fontSize: "0.65rem", padding: "1px 6px" }}
                      >
                        Last opened
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    className="vault-btn vault-btn--ghost vault-btn--icon"
                    onClick={(e) => {
                      e.stopPropagation();
                      onRemoveRecent(vaultPath);
                    }}
                    title="Remove from recent list"
                    aria-label={`Remove ${vaultPath} from recent list`}
                  >
                    <IconClose />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
