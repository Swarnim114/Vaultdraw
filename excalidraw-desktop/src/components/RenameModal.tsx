import { useEffect, useRef, useState } from "react";

import { getCleanDrawingName, validateEntryName } from "../vault/treeStore";

import { IconClose } from "./Icons";

interface RenameModalProps {
  initialName: string;
  kind: "drawing" | "folder";
  onRename: (newName: string) => void | Promise<void>;
  onCancel: () => void;
  ownerDocument?: Document | null;
}

export const RenameModal = ({
  initialName,
  kind,
  onRename,
  onCancel,
  ownerDocument,
}: RenameModalProps) => {
  const cleanInitial =
    kind === "drawing" ? getCleanDrawingName(initialName) : initialName;
  const [name, setName] = useState(cleanInitial);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const targetName =
      kind === "drawing" ? `${name.trim()}.excalidraw` : name.trim();
    const validation = validateEntryName(targetName, kind);
    if (!validation.valid) {
      setError(validation.error ?? "Invalid name");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await onRename(targetName);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
    }
  };

  return (
    <div
      className="vault-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="rename-modal-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onCancel();
        }
      }}
    >
      <div className="vault-modal">
        <form onSubmit={handleSubmit}>
          <div className="vault-modal__header">
            <h3 id="rename-modal-title" className="vault-modal__title">
              Rename {kind === "drawing" ? "Drawing" : "Folder"}
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
            <div className="vault-field">
              <label htmlFor="rename-input">New name</label>
              <input
                id="rename-input"
                ref={inputRef}
                type="text"
                className="vault-input"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  if (error) {
                    setError(null);
                  }
                }}
                disabled={submitting}
              />
              {kind === "drawing" && (
                <span
                  style={{
                    fontSize: "0.75rem",
                    color: "var(--vault-text-faint)",
                  }}
                >
                  Extension .excalidraw will be kept automatically
                </span>
              )}
              {error && <div className="vault-error-text">{error}</div>}
            </div>
          </div>
          <div className="vault-modal__footer">
            <button
              type="button"
              className="vault-btn"
              onClick={onCancel}
              disabled={submitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="vault-btn vault-btn--primary"
              disabled={submitting || !name.trim()}
            >
              {submitting ? "Renaming..." : "Rename"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
