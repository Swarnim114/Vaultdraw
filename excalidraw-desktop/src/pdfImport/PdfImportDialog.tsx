import { useMemo, useRef, useState } from "react";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { IconClose } from "../components/Icons";
import { useModalKeys } from "../components/page/useModalKeys";

import { currentDrawingBytes, estimateImport } from "./budget";
import { planPdfPlacement } from "./layout";
import { parsePageRange } from "./pageRange";
import { MAX_DRAWING_BYTES, PDF_IMPORT_LIMITS } from "./types";

import "./pdfImport.css";

import type { PdfImportProgress, PdfImportSettings, PdfInfo } from "./types";

type Props = {
  info: PdfInfo;
  settings: PdfImportSettings;
  /** The drawing the pages go into (placement, current size, page mode). */
  api: ExcalidrawImperativeAPI | null;
  /** Non-null while the import runs. */
  progress: PdfImportProgress | null;
  onImport: (indices: number[]) => void;
  /** Closes the dialog; while importing it aborts the import. */
  onCancel: () => void;
  ownerDocument?: Document | null;
};

const MB = 1024 * 1024;
const formatMb = (bytes: number) =>
  bytes >= 10 * MB
    ? `${Math.round(bytes / MB)} MB`
    : `${(bytes / MB).toFixed(1)} MB`;

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export const PdfImportDialog = ({
  info,
  settings,
  api,
  progress,
  onImport,
  onCancel,
  ownerDocument,
}: Props) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  const rangeRef = useRef<HTMLInputElement>(null);
  const [range, setRange] = useState("all");
  const running = progress !== null;
  useModalKeys(dialogRef, rangeRef, onCancel, ownerDocument);

  // What the drawing looks like right now (the dialog is modal: it can't change).
  const scene = useMemo(() => {
    const elements = api?.getSceneElements() ?? [];
    return {
      elements,
      pageSetup: api?.getAppState().pageSetup ?? null,
      currentBytes: currentDrawingBytes(elements, api?.getFiles()),
    };
  }, [api]);

  const parsed = useMemo(
    () => parsePageRange(range, info.pageCount),
    [range, info.pageCount],
  );
  const requested = useMemo(
    () => ("pages" in parsed ? parsed.pages : []),
    [parsed],
  );

  const plan = useMemo(
    () =>
      planPdfPlacement({
        pages: info.pages,
        indices: requested,
        elements: scene.elements,
        pageSetup: scene.pageSetup,
      }),
    [info.pages, requested, scene],
  );
  const pageMode = plan.pageCount !== undefined;
  const limit = Math.min(PDF_IMPORT_LIMITS.maxPages, plan.maxPagesThatFit);
  const indices = useMemo(() => requested.slice(0, limit), [requested, limit]);

  const estimate = useMemo(
    () =>
      estimateImport({
        pages: info.pages,
        indices,
        settings,
        currentBytes: scene.currentBytes,
      }),
    [info.pages, indices, settings, scene.currentBytes],
  );

  let error: string | null = "error" in parsed ? parsed.error : null;
  if (!error && indices.length === 0) {
    error = pageMode ? "No room left for more pages" : "No pages selected";
  }

  const warnings: string[] = [];
  if (requested.length > limit) {
    warnings.push(
      pageMode && plan.maxPagesThatFit < PDF_IMPORT_LIMITS.maxPages
        ? `Only ${limit} of ${
            requested.length
          } pages fit in page mode (${plural(
            plan.startPage ?? 0,
            "page",
          )} already used)`
        : `Only ${limit} of ${requested.length} pages can be imported at once`,
    );
  }
  if (indices.length > settings.warnPages) {
    warnings.push(
      `${indices.length} pages is a lot: the drawing will be large and may feel slow`,
    );
  }
  if (!error && estimate.pagesThatFit < indices.length) {
    warnings.push(
      `Only ${estimate.pagesThatFit} of ${
        indices.length
      } pages fit in this drawing (${MAX_DRAWING_BYTES / MB} MB limit)`,
    );
  }

  const placement = pageMode
    ? `on pages ${(plan.startPage ?? 0) + 1}–${
        (plan.startPage ?? 0) + indices.length
      }`
    : "below the drawing";

  const submit = () => {
    if (!running && !error) {
      onImport(indices);
    }
  };

  return (
    <div
      className="vault-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Import PDF"
      onClick={(event) => {
        if (event.target === event.currentTarget && !running) {
          onCancel();
        }
      }}
      onKeyDown={(event) => {
        if (
          event.key === "Enter" &&
          !(event.target as HTMLElement).closest("button")
        ) {
          event.preventDefault();
          submit();
        }
      }}
    >
      <div ref={dialogRef} className="vault-modal pdf-dialog">
        <div className="vault-modal__header">
          <h3 className="vault-modal__title">Import PDF</h3>
          <button
            type="button"
            className="vault-btn vault-btn--ghost vault-btn--icon"
            onClick={onCancel}
            aria-label="Close"
          >
            <IconClose />
          </button>
        </div>
        <div className="vault-modal__body pdf-dialog__body">
          <div className="pdf-dialog__file">
            <strong className="pdf-dialog__name" title={info.name}>
              {info.name}
            </strong>
            <span className="pdf-dialog__muted">
              {plural(info.pageCount, "page")}
            </span>
          </div>
          <label className="pdf-dialog__row">
            <span className="pdf-dialog__label">Pages</span>
            <input
              ref={rangeRef}
              type="text"
              className="vault-input"
              value={range}
              disabled={running}
              spellCheck={false}
              placeholder="all, or e.g. 1-5, 8, 10-"
              aria-invalid={error !== null}
              aria-describedby="pdf-dialog-status"
              onChange={(event) => setRange(event.target.value)}
            />
          </label>
          <div id="pdf-dialog-status" className="pdf-dialog__status">
            {error ? (
              <div className="pdf-dialog__error" role="alert">
                {error}
              </div>
            ) : (
              <div>
                {plural(indices.length, "page")} {placement}. ≈{" "}
                {formatMb(estimate.totalBytes)}, rendered at {estimate.side} px
              </div>
            )}
            {warnings.map((warning) => (
              <div key={warning} className="pdf-dialog__warning" role="status">
                {warning}
              </div>
            ))}
            <div className="pdf-dialog__muted">
              Pages stay white in dark mode.
            </div>
          </div>
          {progress && (
            <div className="pdf-dialog__progress">
              <div>
                Rendering page {Math.min(progress.done + 1, progress.total)} of{" "}
                {progress.total}
              </div>
              <div
                className="pdf-dialog__bar"
                role="progressbar"
                aria-label="Import progress"
                aria-valuemin={0}
                aria-valuemax={progress.total}
                aria-valuenow={progress.done}
              >
                <div
                  className="pdf-dialog__bar-fill"
                  style={{
                    width: `${
                      progress.total
                        ? (progress.done / progress.total) * 100
                        : 0
                    }%`,
                  }}
                />
              </div>
            </div>
          )}
        </div>
        <div className="vault-modal__footer">
          <button type="button" className="vault-btn" onClick={onCancel}>
            Cancel
          </button>
          {!running && (
            <button
              type="button"
              className="vault-btn vault-btn--primary"
              disabled={error !== null}
              onClick={submit}
            >
              Import
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default PdfImportDialog;
