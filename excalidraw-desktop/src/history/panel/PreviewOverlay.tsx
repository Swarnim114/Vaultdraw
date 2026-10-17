import { lazy, Suspense, useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

import type { LoadedVersion } from "../preview/versionCache";
import type { VersionPreviewProps } from "../preview/VersionPreview";

const isEditable = (target: EventTarget | null) =>
  target instanceof Element &&
  !!target.closest("input, textarea, select, [contenteditable='true']");

// Mounting a second editor is the heavy part, and only a selection needs it.
const VersionPreview = lazy(() => import("../preview/VersionPreview"));

export interface PreviewOverlayProps
  extends Pick<
    VersionPreviewProps,
    "initialViewport" | "theme" | "onApi" | "onSelectionChange" | "onSaveFile"
  > {
  /** Where to render: the editor area (side) or the whole window area. */
  target: HTMLElement;
  fullscreen: boolean;
  version: LoadedVersion | null;
  title: string;
  time: string;
  canCopy: boolean;
  onRestore: () => void;
  onCopy: () => void;
  onBack: () => void;
  /** Rendered at the bottom in full-screen mode. */
  timeline?: ReactNode;
}

/** The read-only preview over the main canvas, with its slim banner. */
export const PreviewOverlay = ({
  target,
  fullscreen,
  version,
  title,
  time,
  canCopy,
  onRestore,
  onCopy,
  onBack,
  timeline,
  ...previewProps
}: PreviewOverlayProps) => {
  const root = useRef<HTMLDivElement>(null);
  const back = useRef(onBack);
  back.current = onBack;

  // The main editor handles keys document-wide (handleKeyboardGlobally), so a
  // key pressed in the preview would also act on the main scene (Delete,
  // Mod+Delete, tool letters). Keys stop at the overlay (React handlers, so
  // the timeline's own keys still run first; React's stopPropagation also
  // stops the native event before it reaches the document). App commands run
  // even earlier through the window-level capture dispatcher. Escape is taken
  // in the capture phase because the preview's own handler stops it.
  useEffect(() => {
    const el = root.current;
    if (!el) {
      return;
    }
    const onEscape = (e: KeyboardEvent) => {
      const inDialog = (e.target as Element | null)?.closest?.(".Modal");
      if (e.key === "Escape" && !inDialog) {
        e.preventDefault();
        e.stopPropagation();
        back.current();
      }
    };
    el.addEventListener("keydown", onEscape, true);
    // WebKit does not focus a clicked <button>, so after "Time travel" focus is
    // on <body> and no Escape reaches the panel or the overlay. Catch it at
    // the document, except where something else owns Escape (dialogs, text
    // fields) or a handler already took it.
    const doc = el.ownerDocument;
    const onDocEscape = (e: KeyboardEvent) => {
      const t = e.target as Element | null;
      if (
        e.key !== "Escape" ||
        e.defaultPrevented ||
        t?.closest?.(
          ".Modal, .vault-modal-backdrop, input, textarea, select, [contenteditable='true']",
        )
      ) {
        return;
      }
      e.preventDefault();
      back.current();
    };
    doc.addEventListener("keydown", onDocEscape);
    return () => {
      el.removeEventListener("keydown", onEscape, true);
      doc.removeEventListener("keydown", onDocEscape);
    };
  }, []);

  return createPortal(
    <div
      ref={root}
      onKeyDown={(e) => {
        e.stopPropagation();
        // Contained keys no longer reach the main editor, which used to
        // swallow Backspace; WebKit would otherwise navigate back with it.
        if (e.key === "Backspace" && !isEditable(e.target)) {
          e.preventDefault();
        }
      }}
      onKeyUp={(e) => e.stopPropagation()}
      className={`vault-history-preview${
        fullscreen ? " vault-history-preview--fullscreen" : ""
      }`}
      data-testid="history-preview"
    >
      <div className="vault-history-preview__banner" role="status">
        <span className="vault-history-preview__title">
          Viewing {title} &middot; {time}
        </span>
        <span className="vault-history-preview__actions">
          <button
            type="button"
            className="vault-btn vault-btn--sm vault-btn--primary"
            data-testid="history-restore"
            onClick={onRestore}
          >
            Restore&hellip;
          </button>
          <button
            type="button"
            className="vault-btn vault-btn--sm"
            data-testid="history-copy-selection"
            disabled={!canCopy}
            title={canCopy ? undefined : "Select elements in the preview first"}
            onClick={onCopy}
          >
            Copy to drawing
          </button>
          <button
            type="button"
            className="vault-btn vault-btn--sm"
            data-testid="history-back"
            onClick={onBack}
          >
            Back to current (Esc)
          </button>
        </span>
      </div>
      <div className="vault-history-preview__canvas">
        <Suspense fallback={null}>
          {/* Mount only with a version: the preview takes its initial
              scene at mount, so a null first render would stay blank. */}
          {version && <VersionPreview version={version} {...previewProps} />}
        </Suspense>
      </div>
      {fullscreen && timeline}
    </div>,
    target,
  );
};
