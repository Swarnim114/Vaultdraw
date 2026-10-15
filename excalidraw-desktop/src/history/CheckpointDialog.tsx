import { useEffect, useRef, useState } from "react";

import { errorMessage } from "../vault/types";
import { IconClose } from "../components/Icons";

import { CHECKPOINT_NAME_MAX, CHECKPOINT_NOTE_MAX } from "./types";

import "./history.css";

interface CheckpointDialogProps {
  /** Resolves when the checkpoint exists; a rejection is shown inline. */
  onSave: (name: string, note: string) => Promise<void>;
  onCancel: () => void;
  ownerDocument?: Document | null;
}

const FOCUSABLE = "input, textarea, button:not([disabled])";

/** Name (required) and note (optional) for a manual checkpoint. */
export const CheckpointDialog = ({
  onSave,
  onCancel,
  ownerDocument,
}: CheckpointDialogProps) => {
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const savingRef = useRef(false);

  useEffect(() => {
    nameRef.current?.focus();
    const doc = ownerDocument;
    if (!doc) {
      return;
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onCancel();
      } else if (e.key === "Tab" && modalRef.current) {
        const items = [
          ...modalRef.current.querySelectorAll<HTMLElement>(FOCUSABLE),
        ];
        if (items.length === 0) {
          return;
        }
        const first = items[0];
        const lastItem = items[items.length - 1];
        const active = doc.activeElement;
        if (
          e.shiftKey &&
          (active === first || !modalRef.current.contains(active))
        ) {
          e.preventDefault();
          lastItem.focus();
        } else if (!e.shiftKey && active === lastItem) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    doc.addEventListener("keydown", onKeyDown, true);
    return () => doc.removeEventListener("keydown", onKeyDown, true);
  }, [onCancel, ownerDocument]);

  const trimmed = name.trim();
  const submit = async () => {
    if (!trimmed || savingRef.current) {
      return;
    }
    savingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      await onSave(trimmed, note);
    } catch (cause) {
      setError(errorMessage(cause));
      savingRef.current = false;
      setSaving(false);
    }
  };

  return (
    <div
      className="vault-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="checkpoint-dialog-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onCancel();
        }
      }}
    >
      <div ref={modalRef} className="vault-modal">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <div className="vault-modal__header">
            <h3 id="checkpoint-dialog-title" className="vault-modal__title">
              Create checkpoint
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
              <label htmlFor="checkpoint-name">Name</label>
              <input
                id="checkpoint-name"
                ref={nameRef}
                type="text"
                className="vault-input"
                maxLength={CHECKPOINT_NAME_MAX}
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={saving}
                autoComplete="off"
                spellCheck={false}
              />
            </div>
            <div className="vault-field">
              <label htmlFor="checkpoint-note">Note (optional)</label>
              <textarea
                id="checkpoint-note"
                className="vault-input vault-history-note"
                rows={3}
                maxLength={CHECKPOINT_NOTE_MAX}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    void submit();
                  }
                }}
                disabled={saving}
              />
            </div>
            {error && <div className="vault-error-text">{error}</div>}
          </div>
          <div className="vault-modal__footer">
            <button
              type="button"
              className="vault-btn"
              onClick={onCancel}
              disabled={saving}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="vault-btn vault-btn--primary"
              disabled={saving || !trimmed}
            >
              {saving ? "Saving..." : "Save checkpoint"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
