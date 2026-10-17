import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { IconClose } from "../components/Icons";
import { useModalKeys } from "../components/page/useModalKeys";

import { renderFormula, warmFormulaRenderer } from "./renderer";
import { svgToDataURL } from "./svgPost";
import { parseFormulaInput } from "./types";

import "./FormulaDialog.css";

import type { FormulaRender } from "./types";
import type { RenderedFormula } from "./insertFormula";

export const PREVIEW_DEBOUNCE_MS = 120;

export type FormulaDialogProps = {
  mode: "insert" | "edit";
  initialSource?: string;
  initialDisplay?: boolean;
  /** Colour the SVG is authored in. */
  color: string;
  onConfirm: (formula: RenderedFormula) => void;
  onCancel: () => void;
  ownerDocument?: Document | null;
};

type Settled = { key: string; render: FormulaRender };

const FormulaDialog = ({
  mode,
  initialSource = "",
  initialDisplay = true,
  color,
  onConfirm,
  onCancel,
  ownerDocument,
}: FormulaDialogProps) => {
  const [text, setText] = useState(initialSource);
  const [displayChoice, setDisplayChoice] = useState(initialDisplay);
  const [settled, setSettled] = useState<Settled | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const seq = useRef(0);

  useModalKeys(dialogRef, closeRef, onCancel, ownerDocument);
  useEffect(() => {
    warmFormulaRenderer();
    textRef.current?.focus();
    textRef.current?.select();
  }, []);

  const parsed = useMemo(() => parseFormulaInput(text), [text]);
  const source = parsed.source;
  const display = parsed.display ?? displayChoice;
  const key = `${display ? 1 : 0}|${color}|${source}`;

  useEffect(() => {
    if (!source) {
      seq.current++;
      return undefined;
    }
    const mine = ++seq.current;
    const timer = setTimeout(() => {
      void renderFormula({ source, display, color }).then((render) => {
        if (mine === seq.current) {
          setSettled({ key, render });
        }
      });
    }, PREVIEW_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [source, display, color, key]);

  const current = settled && settled.key === key && source ? settled : null;
  const render = current?.render ?? null;
  const error = render && !render.ok ? render.error : null;
  const canConfirm = !!render && render.ok;
  const previewSrc = render && render.ok ? svgToDataURL(render.svg) : null;

  const confirm = useCallback(() => {
    if (render && render.ok) {
      onConfirm({
        svg: render.svg,
        width: render.width,
        height: render.height,
        source,
        display,
        color,
      });
    }
  }, [render, onConfirm, source, display, color]);

  const title = mode === "insert" ? "Insert formula" : "Edit formula";

  return (
    <div
      className="vault-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="formula-dialog-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onCancel();
        }
      }}
    >
      <div
        className="vault-modal vault-formula"
        ref={dialogRef}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            confirm();
          }
        }}
      >
        <div className="vault-modal__header">
          <h3 id="formula-dialog-title" className="vault-modal__title">
            {title}
          </h3>
          <button
            type="button"
            ref={closeRef}
            className="vault-btn vault-btn--ghost vault-btn--icon"
            onClick={onCancel}
            aria-label="Close"
          >
            <IconClose />
          </button>
        </div>
        <div className="vault-modal__body">
          <div className="vault-field">
            <label htmlFor="formula-source">LaTeX</label>
            <textarea
              id="formula-source"
              ref={textRef}
              className="vault-input vault-formula__source"
              value={text}
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              placeholder="e.g. \int_0^1 x^2\,dx = \frac13"
              onChange={(e) => setText(e.target.value)}
            />
          </div>
          <label className="vault-formula__option">
            <input
              type="checkbox"
              checked={display}
              disabled={parsed.display !== undefined}
              onChange={(e) => setDisplayChoice(e.target.checked)}
            />
            Display mode
          </label>
          <div className="vault-formula__preview" aria-label="Preview">
            {previewSrc ? (
              <img src={previewSrc} alt="Formula preview" />
            ) : (
              <span className="vault-formula__placeholder">
                {source && !error ? "Rendering…" : "Preview"}
              </span>
            )}
          </div>
          {error && (
            <div className="vault-error-text" role="alert">
              {error}
            </div>
          )}
        </div>
        <div className="vault-modal__footer">
          <button type="button" className="vault-btn" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="vault-btn vault-btn--primary"
            disabled={!canConfirm}
            onClick={confirm}
          >
            {mode === "insert" ? "Insert" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default FormulaDialog;
