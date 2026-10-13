import { useEffect, useState } from "react";

import { getBaseName, isMoveAllowed } from "../vault/treeStore";

import { IconClose, IconFolder } from "./Icons";

interface MoveModalProps {
  sourcePath: string;
  sourceKind: "drawing" | "folder";
  folders: string[]; // List of all known folder paths in vault, e.g. ["", "DSA", "DSA/Dynamic Programming"]
  onMove: (destinationParentPath: string) => void | Promise<void>;
  onCancel: () => void;
  ownerDocument?: Document | null;
}

export const MoveModal = ({
  sourcePath,
  sourceKind,
  folders,
  onMove,
  onCancel,
  ownerDocument,
}: MoveModalProps) => {
  const [selectedFolder, setSelectedFolder] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);

  useEffect(() => {
    const doc = ownerDocument;
    if (!doc) {
      return;
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      }
    };
    doc.addEventListener("keydown", handleKeyDown);
    return () => doc.removeEventListener("keydown", handleKeyDown);
  }, [onCancel, ownerDocument]);

  const sortedFolders = Array.from(new Set(["", ...folders])).sort((a, b) => {
    if (a === "") {
      return -1;
    }
    if (b === "") {
      return 1;
    }
    return a.localeCompare(b);
  });

  const handleConfirm = async () => {
    const check = isMoveAllowed(sourcePath, selectedFolder);
    if (!check.allowed) {
      setError(check.reason ?? "Invalid move target");
      return;
    }
    setMoving(true);
    setError(null);
    try {
      await onMove(selectedFolder);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
      setMoving(false);
    }
  };

  const entryName = getBaseName(sourcePath);

  return (
    <div
      className="vault-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="move-modal-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onCancel();
        }
      }}
    >
      <div className="vault-modal">
        <div className="vault-modal__header">
          <h3 id="move-modal-title" className="vault-modal__title">
            Move {sourceKind === "drawing" ? "Drawing" : "Folder"}
          </h3>
          <button
            type="button"
            className="vault-btn vault-btn--ghost vault-btn--icon"
            onClick={onCancel}
            aria-label="Close"
          >
            <IconClose />
          </button>
        </div>
        <div className="vault-modal__body">
          <p
            style={{
              margin: "0 0 12px 0",
              fontSize: "0.85rem",
              color: "var(--vault-text-muted)",
            }}
          >
            Select destination folder for <strong>{entryName}</strong>:
          </p>
          <div
            style={{
              maxHeight: "220px",
              overflowY: "auto",
              border: "1px solid var(--vault-border)",
              borderRadius: "var(--vault-radius)",
              padding: "4px 0",
              backgroundColor: "var(--vault-surface)",
            }}
          >
            {sortedFolders.map((f) => {
              const check = isMoveAllowed(sourcePath, f);
              const isSelected = selectedFolder === f;
              const depth = f === "" ? 0 : f.split("/").length;
              const label = f === "" ? "/ (Vault root)" : f;

              return (
                <div
                  key={f}
                  role="button"
                  tabIndex={check.allowed ? 0 : -1}
                  aria-disabled={!check.allowed}
                  onClick={() => {
                    if (check.allowed) {
                      setSelectedFolder(f);
                      setError(null);
                    }
                  }}
                  onKeyDown={(e) => {
                    if (check.allowed && (e.key === "Enter" || e.key === " ")) {
                      setSelectedFolder(f);
                      setError(null);
                    }
                  }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    padding: "6px 12px",
                    paddingLeft: `${12 + depth * 12}px`,
                    fontSize: "0.82rem",
                    cursor: check.allowed ? "pointer" : "not-allowed",
                    opacity: check.allowed ? 1 : 0.45,
                    backgroundColor: isSelected
                      ? "var(--vault-surface-active)"
                      : "transparent",
                    color: isSelected
                      ? "var(--vault-primary)"
                      : "var(--vault-text)",
                    fontWeight: isSelected ? 600 : 400,
                  }}
                >
                  <IconFolder />
                  <span
                    style={{
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {label}
                  </span>
                </div>
              );
            })}
          </div>
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
            onClick={onCancel}
            disabled={moving}
          >
            Cancel
          </button>
          <button
            type="button"
            className="vault-btn vault-btn--primary"
            onClick={() => void handleConfirm()}
            disabled={moving}
          >
            {moving ? "Moving..." : "Move Here"}
          </button>
        </div>
      </div>
    </div>
  );
};
