import { useCallback, useEffect, useState } from "react";

import { duplicateName, getBaseName } from "../vault/treeStore";

import { IconClose, IconTrash } from "./Icons";

import type { RecoveryEntry, VaultRepository } from "../vault/types";

interface RecoveryDialogProps {
  handle: string;
  repository: VaultRepository;
  onOpenRecovered: (path: string, json: string) => void | Promise<void>;
  onClose: () => void;
  ownerDocument?: Document | null;
}

export const RecoveryDialog = ({
  handle,
  repository,
  onOpenRecovered,
  onClose,
  ownerDocument,
}: RecoveryDialogProps) => {
  const [entries, setEntries] = useState<RecoveryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadEntries = useCallback(async () => {
    setLoading(true);
    try {
      const list = await repository.listRecovery(handle);
      setEntries(list);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [handle, repository]);

  useEffect(() => {
    void loadEntries();
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
  }, [loadEntries, onClose, ownerDocument]);

  const handleDiscard = async (id: string) => {
    setProcessingId(id);
    setError(null);
    try {
      await repository.discardRecovery(handle, id);
      setEntries((prev) => prev.filter((item) => item.id !== id));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setProcessingId(null);
    }
  };

  const handleRestore = async (entry: RecoveryEntry) => {
    setProcessingId(entry.id);
    setError(null);
    try {
      const recoveredPath = duplicateName(entry.path);
      await onOpenRecovered(recoveredPath, entry.json);
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
      setProcessingId(null);
    }
  };

  return (
    <div
      className="vault-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="recovery-dialog-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="vault-modal" style={{ maxWidth: "560px" }}>
        <div className="vault-modal__header">
          <h3 id="recovery-dialog-title" className="vault-modal__title">
            Recoverable Snapshots
          </h3>
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
          <p
            style={{
              marginTop: 0,
              fontSize: "0.85rem",
              color: "var(--vault-text-muted)",
            }}
          >
            These snapshots were saved locally before a crash or external
            conflict. You can open any snapshot as a new copy or discard it.
          </p>

          {loading ? (
            <div
              style={{
                textAlign: "center",
                padding: "24px 0",
                color: "var(--vault-text-muted)",
              }}
            >
              Loading snapshots...
            </div>
          ) : entries.length === 0 ? (
            <div
              style={{
                textAlign: "center",
                padding: "24px 0",
                color: "var(--vault-text-muted)",
              }}
            >
              No recoverable snapshots found for this vault.
            </div>
          ) : (
            <div className="vault-recovery-list">
              {entries.map((entry) => {
                const dateStr = new Date(entry.modifiedAt).toLocaleString();
                const isWorking = processingId === entry.id;

                return (
                  <div key={entry.id} className="vault-recovery-item">
                    <div style={{ minWidth: 0, flex: "1 1 auto" }}>
                      <div className="vault-recovery-item__path">
                        {entry.path}
                      </div>
                      <div className="vault-recovery-item__time">
                        {dateStr} • {getBaseName(entry.path)}
                      </div>
                    </div>
                    <div
                      style={{
                        display: "flex",
                        gap: "6px",
                        alignItems: "center",
                      }}
                    >
                      <button
                        type="button"
                        className="vault-btn vault-btn--primary vault-btn--sm"
                        onClick={() => void handleRestore(entry)}
                        disabled={isWorking}
                      >
                        Open as Copy
                      </button>
                      <button
                        type="button"
                        className="vault-btn vault-btn--ghost vault-btn--sm"
                        onClick={() => void handleDiscard(entry.id)}
                        disabled={isWorking}
                        aria-label="Discard snapshot"
                        title="Discard snapshot"
                      >
                        <IconTrash />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {error && (
            <div className="vault-error-text" style={{ marginTop: "12px" }}>
              {error}
            </div>
          )}
        </div>
        <div className="vault-modal__footer">
          <button type="button" className="vault-btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
