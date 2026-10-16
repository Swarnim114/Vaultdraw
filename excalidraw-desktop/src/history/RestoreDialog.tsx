import { useRef } from "react";

import { IconClose } from "../components/Icons";
import { useModalKeys } from "../components/page/useModalKeys";

import { REFUSAL_TEXT } from "./restore";

import "./history.css";

import type { ReplaceRefusal } from "./restore";

export interface RestoreDialogProps {
  versionLabel: string;
  replaceRefusal: ReplaceRefusal;
  onReplace(): void;
  onCopy(): void;
  onCancel(): void;
  ownerDocument?: Document | null;
}

/** Replace the drawing (undoable) or restore the version as a new file. */
export const RestoreDialog = ({
  versionLabel,
  replaceRefusal,
  onReplace,
  onCopy,
  onCancel,
  ownerDocument,
}: RestoreDialogProps) => {
  const modalRef = useRef<HTMLDivElement>(null);
  // Focus the first enabled button; Enter activates it natively.
  const firstRef = useRef<HTMLButtonElement>(null);
  const copyRef = useRef<HTMLButtonElement>(null);
  const refused = replaceRefusal !== null;
  useModalKeys(modalRef, refused ? copyRef : firstRef, onCancel, ownerDocument);

  return (
    <div
      className="vault-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="restore-dialog-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onCancel();
        }
      }}
    >
      <div ref={modalRef} className="vault-modal">
        <div className="vault-modal__header">
          <h3 id="restore-dialog-title" className="vault-modal__title">
            Restore {versionLabel}?
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
          <p>
            Replacing keeps your current drawing recoverable: a version is saved
            first and Cmd+Z undoes the restore.
          </p>
          {refused && (
            <div className="vault-error-text" role="status">
              {REFUSAL_TEXT[replaceRefusal]}
            </div>
          )}
        </div>
        <div className="vault-modal__footer">
          <button type="button" className="vault-btn" onClick={onCancel}>
            Cancel
          </button>
          <button
            ref={copyRef}
            type="button"
            className="vault-btn"
            onClick={onCopy}
          >
            Restore as a copy
          </button>
          <button
            ref={firstRef}
            type="button"
            className="vault-btn vault-btn--primary"
            disabled={refused}
            title={refused ? REFUSAL_TEXT[replaceRefusal] : undefined}
            onClick={onReplace}
          >
            Replace current drawing
          </button>
        </div>
      </div>
    </div>
  );
};

export default RestoreDialog;
