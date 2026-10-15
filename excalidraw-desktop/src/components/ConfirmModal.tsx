import { useEffect, useRef } from "react";

import { IconClose } from "./Icons";

interface ConfirmModalProps {
  title: string;
  message: string;
  /** Optional list under the message (e.g. affected links). */
  details?: string[];
  confirmLabel?: string;
  cancelLabel?: string;
  isDanger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  ownerDocument?: Document | null;
}

export const ConfirmModal = ({
  title,
  message,
  details,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  isDanger = false,
  onConfirm,
  onCancel,
  ownerDocument,
}: ConfirmModalProps) => {
  const confirmBtnRef = useRef<HTMLButtonElement>(null);
  const cancelBtnRef = useRef<HTMLButtonElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isDanger) {
      cancelBtnRef.current?.focus();
    } else {
      confirmBtnRef.current?.focus();
    }
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
  }, [isDanger, onCancel, ownerDocument]);

  return (
    <div
      className="vault-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onCancel();
        }
      }}
    >
      <div ref={modalRef} className="vault-modal">
        <div className="vault-modal__header">
          <h3 id="confirm-dialog-title" className="vault-modal__title">
            {title}
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
          <p style={{ margin: 0 }}>{message}</p>
          {details && details.length > 0 && (
            <ul
              className="vault-modal__details"
              style={{
                margin: "8px 0 0",
                paddingLeft: 18,
                maxHeight: 160,
                overflowY: "auto",
                fontSize: "0.85em",
              }}
            >
              {details.slice(0, 50).map((line, i) => (
                <li key={i}>{line}</li>
              ))}
              {details.length > 50 && <li>…and {details.length - 50} more</li>}
            </ul>
          )}
        </div>
        <div className="vault-modal__footer">
          <button
            ref={cancelBtnRef}
            type="button"
            className="vault-btn"
            onClick={onCancel}
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmBtnRef}
            type="button"
            className={`vault-btn ${
              isDanger ? "vault-btn--danger" : "vault-btn--primary"
            }`}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};
