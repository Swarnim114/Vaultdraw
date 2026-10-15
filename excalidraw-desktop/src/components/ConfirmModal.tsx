import { useEffect, useRef } from "react";

import { Dialog } from "./Dialog";

interface ConfirmModalProps {
  title: string;
  /** Names the item and says what will happen to it. */
  message: string;
  /** Optional list under the message (e.g. affected links). */
  details?: string[];
  confirmLabel?: string;
  cancelLabel?: string;
  /** Destructive: the confirm button is the one filled danger button. */
  isDanger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
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
}: ConfirmModalProps) => {
  const confirmBtnRef = useRef<HTMLButtonElement>(null);
  const cancelBtnRef = useRef<HTMLButtonElement>(null);

  // Destructive confirmations start on Cancel so a stray Enter is safe.
  useEffect(() => {
    (isDanger ? cancelBtnRef : confirmBtnRef).current?.focus();
  }, [isDanger]);

  return (
    <Dialog
      title={title}
      titleId="confirm-dialog-title"
      onClose={onCancel}
      footer={
        <>
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
        </>
      }
    >
      <p>{message}</p>
      {details && details.length > 0 && (
        <ul className="vault-modal__details vd-dialog__details">
          {details.slice(0, 50).map((line, i) => (
            <li key={i}>{line}</li>
          ))}
          {details.length > 50 && <li>…and {details.length - 50} more</li>}
        </ul>
      )}
    </Dialog>
  );
};
