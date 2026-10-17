import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

import type { ExcalidrawElement } from "@excalidraw/element/types";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { registerCommandHandlers } from "../../commands/handlerRegistry";
import { diffScenes, isEmptyDiff } from "../diff";
import { HISTORY_COMMAND_IDS } from "../historyCommands";
import { ChangeOverlay } from "../preview/ChangeOverlay";

import type { LoadedVersion } from "../preview/versionCache";
import type { VersionPreviewProps } from "../preview/VersionPreview";

const PREVIEWING_CLASS = "vault-history-previewing";

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
  /**
   * The current drawing's elements including deleted ones (the diff
   * reference). Without it there are no change highlights.
   */
  getCurrentElements?: () => readonly ExcalidrawElement[];
  /** Initial highlight state (`history.highlight_changes`); default on. */
  highlightChanges?: boolean;
}

const Legend = ({
  added,
  changed,
  removed,
}: {
  added: number;
  changed: number;
  removed: number;
}) => (
  <span className="vault-change-legend" data-testid="history-legend">
    {added > 0 && (
      <span className="vault-change-legend__item vault-change-legend__item--added">
        <i className="vault-change-legend__swatch" />
        Only in this version {added}
      </span>
    )}
    {changed > 0 && (
      <span className="vault-change-legend__item vault-change-legend__item--changed">
        <i className="vault-change-legend__swatch" />
        Changed since {changed}
      </span>
    )}
    {removed > 0 && (
      <span className="vault-change-legend__item vault-change-legend__item--removed">
        <i className="vault-change-legend__swatch" />
        Not in this version {removed}
      </span>
    )}
    {added + changed + removed === 0 && <span>No changes since</span>}
  </span>
);

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
  getCurrentElements,
  highlightChanges = true,
  ...previewProps
}: PreviewOverlayProps) => {
  const root = useRef<HTMLDivElement>(null);
  const [previewApi, setPreviewApi] = useState<ExcalidrawImperativeAPI | null>(
    null,
  );
  const { onApi } = previewProps;
  const handleApi = useCallback(
    (api: ExcalidrawImperativeAPI | null) => {
      setPreviewApi(api);
      onApi?.(api);
    },
    [onApi],
  );

  // Session state: the toggle never writes the setting.
  const [highlights, setHighlights] = useState(highlightChanges);
  const canHighlight = !!getCurrentElements;
  useEffect(() => {
    if (!canHighlight) {
      return;
    }
    return registerCommandHandlers({
      [HISTORY_COMMAND_IDS.toggleHighlights]: () => setHighlights((on) => !on),
    });
  }, [canHighlight]);
  const diff = useMemo(
    () =>
      canHighlight && version
        ? diffScenes(version.elements, getCurrentElements!())
        : null,
    // The current scene is read once per version (it rarely changes while previewing).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [version, canHighlight],
  );
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
    // Lets the preview's modals cover the window (see historyPanel.css).
    doc.body.classList.add(PREVIEWING_CLASS);
    return () => {
      doc.body.classList.remove(PREVIEWING_CLASS);
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
        {diff && highlights && (
          <Legend
            added={diff.added.length}
            changed={diff.changed.length}
            removed={diff.removed.length}
          />
        )}
        <span className="vault-history-preview__actions">
          {diff && (
            <button
              type="button"
              className="vault-btn vault-btn--sm"
              data-testid="history-highlights"
              aria-pressed={highlights}
              title={
                isEmptyDiff(diff)
                  ? "Nothing differs from the current drawing"
                  : undefined
              }
              onClick={() => setHighlights((on) => !on)}
            >
              Highlights
            </button>
          )}
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
          {version && (
            <VersionPreview
              version={version}
              {...previewProps}
              onApi={handleApi}
            />
          )}
        </Suspense>
        {diff && highlights && version && (
          <ChangeOverlay
            api={previewApi}
            diff={diff}
            versionElements={version.elements}
          />
        )}
      </div>
      {fullscreen && timeline}
    </div>,
    target,
  );
};
