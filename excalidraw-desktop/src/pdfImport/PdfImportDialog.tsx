import { useEffect, useMemo, useRef, useState } from "react";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { Dialog } from "../components/Dialog";

import { currentDrawingBytes, estimateImport } from "./budget";
import { planPdfPlacement } from "./layout";
import { pdfErrorMessage } from "./pdfErrors";
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
  /** Unlocks a password-protected PDF; rejects with PDF_BAD_PASSWORD when wrong. */
  onUnlock?: (password: string) => Promise<void>;
};

const MB = 1024 * 1024;
const formatMb = (bytes: number) =>
  bytes >= 10 * MB
    ? `${Math.round(bytes / MB)} MB`
    : `${(bytes / MB).toFixed(1)} MB`;

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

const PasswordPrompt = ({
  name,
  onUnlock,
  onCancel,
}: {
  name: string;
  onUnlock?: (password: string) => Promise<void>;
  onCancel: () => void;
}) => {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const alive = useRef(true);
  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );

  const submit = async () => {
    if (checking || password === "" || !onUnlock) {
      return;
    }
    setChecking(true);
    setError(null);
    try {
      await onUnlock(password);
    } catch (err) {
      if (alive.current) {
        setError(pdfErrorMessage(err));
        setChecking(false);
        input.current?.focus();
        input.current?.select();
      }
    }
  };

  return (
    <Dialog
      title="Import PDF"
      titleId="pdf-dialog-title"
      className="pdf-dialog"
      testId="pdf-dialog"
      onClose={onCancel}
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      footer={
        <>
          <button type="button" className="vault-btn" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="submit"
            className="vault-btn vault-btn--primary"
            disabled={checking || password === ""}
          >
            Unlock
          </button>
        </>
      }
    >
      <div className="pdf-dialog__body">
        <div className="pdf-dialog__file">
          <strong className="pdf-dialog__name" title={name}>
            {name}
          </strong>
        </div>
        <div className="pdf-dialog__status">
          This PDF is password-protected. Enter its password to import it.
        </div>
        <label className="pdf-dialog__row">
          <span className="pdf-dialog__label">Password</span>
          <input
            ref={input}
            autoFocus
            type="password"
            className="vault-input"
            value={password}
            disabled={checking}
            autoComplete="off"
            spellCheck={false}
            aria-invalid={error !== null}
            aria-describedby="pdf-dialog-password-status"
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        <div id="pdf-dialog-password-status" className="pdf-dialog__status">
          {error && (
            <div className="pdf-dialog__error" role="alert">
              {error}
            </div>
          )}
        </div>
      </div>
    </Dialog>
  );
};

export const PdfImportDialog = (props: Props) =>
  props.info.locked ? (
    <PasswordPrompt
      name={props.info.name}
      onUnlock={props.onUnlock}
      onCancel={props.onCancel}
    />
  ) : (
    <ImportOptions {...props} />
  );

const ImportOptions = ({
  info,
  settings,
  api,
  progress,
  onImport,
  onCancel,
}: Props) => {
  const [range, setRange] = useState("all");
  const running = progress !== null;

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
    <Dialog
      title="Import PDF"
      titleId="pdf-dialog-title"
      className="pdf-dialog"
      testId="pdf-dialog"
      // Not `busy`: Escape must still abort a running import.
      onClose={onCancel}
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      footer={
        <>
          <button type="button" className="vault-btn" onClick={onCancel}>
            Cancel
          </button>
          {!running && (
            <button
              type="submit"
              className="vault-btn vault-btn--primary"
              disabled={error !== null}
            >
              Import
            </button>
          )}
        </>
      }
    >
      <div className="pdf-dialog__body">
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
            autoFocus
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
                    progress.total ? (progress.done / progress.total) * 100 : 0
                  }%`,
                }}
              />
            </div>
          </div>
        )}
      </div>
    </Dialog>
  );
};

export default PdfImportDialog;
