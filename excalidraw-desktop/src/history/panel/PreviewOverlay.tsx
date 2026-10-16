import { lazy, Suspense, type ReactNode } from "react";
import { createPortal } from "react-dom";

import type { LoadedVersion } from "../preview/versionCache";
import type { VersionPreviewProps } from "../preview/VersionPreview";

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
}: PreviewOverlayProps) =>
  createPortal(
    <div
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
          <VersionPreview version={version} {...previewProps} />
        </Suspense>
      </div>
      {fullscreen && timeline}
    </div>,
    target,
  );
