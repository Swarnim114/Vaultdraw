import { useEffect, useState } from "react";

import { duplicateName, getBaseName } from "../vault/treeStore";

import { IconAlert, IconClose } from "./Icons";

interface ConflictDialogProps {
  currentPath: string;
  errorMessage?: string | null;
  onReload: () => void | Promise<void>;
  onSaveCopy: (copyPath: string) => void | Promise<void>;
  onClose: () => void;
  ownerDocument?: Document | null;
}

export const ConflictDialog = ({
  currentPath,
  errorMessage,
  onReload,
  onSaveCopy,
  onClose,
  ownerDocument,
}: ConflictDialogProps) => {
  const suggestedCopy = duplicateName(currentPath);
  const [copyPath, setCopyPath] = useState(suggestedCopy);
  const [showCopyInput, setShowCopyInput] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const doc = ownerDocument;
    if (!doc) {
      return;
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    doc.addEventListener("keydown", handleKeyDown);
    return () => doc.removeEventListener("keydown", handleKeyDown);
  }, [onClose, ownerDocument]);

  const handleReload = async () => {
    setProcessing(true);
    setError(null);
    try {
      await onReload();
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
      setProcessing(false);
    }
  };

  const handleSaveCopy = async () => {
    setProcessing(true);
    setError(null);
    try {
      await onSaveCopy(copyPath.trim());
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
      setProcessing(false);
    }
  };

  const fileName = getBaseName(currentPath);

  return (
    <div
      className="vault-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="conflict-dialog-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="vault-modal">
        <div className="vault-modal__header">
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{ color: "var(--vault-warning)" }}>
              <IconAlert />
            </span>
            <h3 id="conflict-dialog-title" className="vault-modal__title">
              File Conflict Detected
            </h3>
          </div>
          <button
            type="button"
            className="vault-btn vault-btn--ghost vault-btn--icon"
            onClick={onClose}
            aria-label="Close"
          >
            <IconClose />
          </button>
        </div>
        <div className="vault-modal__body">
          <p style={{ marginTop: 0 }}>
            <strong>{fileName}</strong> was changed or deleted on disk outside
            Excalidraw Vault while you had unsaved edits.
          </p>
          {errorMessage && (
            <div
              style={{
                fontSize: "0.8rem",
                color: "var(--vault-warning)",
                backgroundColor: "var(--vault-warning-bg)",
                border: "1px solid var(--vault-warning-border)",
                padding: "8px 12px",
                borderRadius: "var(--vault-radius)",
                marginBottom: "12px",
              }}
            >
              {errorMessage}
            </div>
          )}

          {showCopyInput ? (
            <div className="vault-field">
              <label htmlFor="copy-path-input">
                Save your current edits to a new file:
              </label>
              <input
                id="copy-path-input"
                type="text"
                className="vault-input"
                value={copyPath}
                onChange={(e) => setCopyPath(e.target.value)}
                disabled={processing}
              />
              <div style={{ display: "flex", gap: "8px", marginTop: "8px" }}>
                <button
                  type="button"
                  className="vault-btn vault-btn--primary"
                  onClick={() => void handleSaveCopy()}
                  disabled={processing || !copyPath.trim()}
                >
                  {processing ? "Saving..." : "Save Copy & Continue"}
                </button>
                <button
                  type="button"
                  className="vault-btn"
                  onClick={() => setShowCopyInput(false)}
                  disabled={processing}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div
              style={{ display: "flex", flexDirection: "column", gap: "10px" }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "10px",
                  border: "1px solid var(--vault-border)",
                  borderRadius: "var(--vault-radius)",
                }}
              >
                <div>
                  <div style={{ fontWeight: 600, fontSize: "0.85rem" }}>
                    Save My Edits as a Copy
                  </div>
                  <div
                    style={{
                      fontSize: "0.78rem",
                      color: "var(--vault-text-muted)",
                    }}
                  >
                    Preserves your current canvas in a separate file (e.g.{" "}
                    {getBaseName(suggestedCopy)}).
                  </div>
                </div>
                <button
                  type="button"
                  className="vault-btn vault-btn--primary vault-btn--sm"
                  onClick={() => setShowCopyInput(true)}
                  disabled={processing}
                >
                  Save as Copy
                </button>
              </div>

              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "10px",
                  border: "1px solid var(--vault-border)",
                  borderRadius: "var(--vault-radius)",
                }}
              >
                <div>
                  <div style={{ fontWeight: 600, fontSize: "0.85rem" }}>
                    Reload from Disk
                  </div>
                  <div
                    style={{
                      fontSize: "0.78rem",
                      color: "var(--vault-text-muted)",
                    }}
                  >
                    Discards your in-editor changes and loads the newer file
                    from disk.
                  </div>
                </div>
                <button
                  type="button"
                  className="vault-btn vault-btn--danger vault-btn--sm"
                  onClick={() => void handleReload()}
                  disabled={processing}
                >
                  Reload Disk
                </button>
              </div>
            </div>
          )}

          {error && (
            <div className="vault-error-text" style={{ marginTop: "10px" }}>
              {error}
            </div>
          )}
        </div>
        <div className="vault-modal__footer">
          <button
            type="button"
            className="vault-btn"
            onClick={onClose}
            disabled={processing}
          >
            Close & Keep Editing
          </button>
        </div>
      </div>
    </div>
  );
};
