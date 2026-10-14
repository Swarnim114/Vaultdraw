import { useRef } from "react";

import { updatePageSetup } from "@excalidraw/excalidraw/data/pageSetup";

import { usePageSetup } from "../../page/usePageSetup";
import {
  getDefaultPageSetup,
  setDefaultPageSetup,
} from "../../vault/pageDefaults";
import { IconClose } from "../Icons";
import { Segmented, Switch } from "../settings/pages/controls";

import {
  LAYOUT_OPTIONS,
  ORIENTATION_OPTIONS,
  PAPER_THEME_OPTIONS,
  orientationChanges,
} from "./pageOptions";
import { PageSizeControl } from "./PageSizeControl";
import { useModalKeys } from "./useModalKeys";

import "./page.css";

type Props = { onClose: () => void; ownerDocument?: Document | null };

/** Per-drawing page settings. Render inside the Excalidraw tree. */
export const PageSetupDialog = ({ onClose, ownerDocument }: Props) => {
  const { pageSetup, setPageSetup, readOnly } = usePageSetup();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useModalKeys(dialogRef, closeRef, onClose, ownerDocument);

  const on = !!pageSetup?.enabled;
  const frozen = readOnly || !on;
  // What the controls show while the drawing is a normal canvas.
  const shown = pageSetup ?? updatePageSetup(null, getDefaultPageSetup());

  const toggle = (enabled: boolean) =>
    // Turning it on starts from the drawing's setup, else the app default.
    setPageSetup(
      enabled && !pageSetup
        ? { ...getDefaultPageSetup(), enabled }
        : { enabled },
    );

  const useAppDefault = () => {
    const { layout, size, orientation, width, height, paperTheme } =
      getDefaultPageSetup();
    setPageSetup({ layout, size, orientation, width, height, paperTheme });
  };

  return (
    <div
      className="vault-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="page-dialog-title"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div ref={dialogRef} className="vault-modal page-dialog">
        <div className="vault-modal__header">
          <h3 id="page-dialog-title" className="vault-modal__title">
            Page setup
          </h3>
          <button
            ref={closeRef}
            type="button"
            className="vault-btn vault-btn--ghost vault-btn--icon"
            onClick={onClose}
            aria-label="Close"
          >
            <IconClose />
          </button>
        </div>
        <div className="vault-modal__body page-dialog__body">
          <div className="page-dialog__row">
            <span className="page-dialog__label">Page mode</span>
            <Switch
              checked={on}
              onChange={toggle}
              label="Page mode"
              disabled={readOnly}
            />
          </div>
          <div className="page-dialog__row">
            <span className="page-dialog__label">Layout</span>
            <Segmented
              options={LAYOUT_OPTIONS}
              value={shown.layout}
              disabled={frozen}
              onChange={(layout) => setPageSetup({ layout })}
            />
          </div>
          <div className="page-dialog__row">
            <span className="page-dialog__label">Size</span>
            <PageSizeControl
              size={shown.size}
              width={shown.width}
              height={shown.height}
              onChange={setPageSetup}
              disabled={frozen}
            />
          </div>
          <div className="page-dialog__row">
            <span className="page-dialog__label">Orientation</span>
            <Segmented
              options={ORIENTATION_OPTIONS}
              value={shown.orientation}
              disabled={frozen}
              onChange={(o) => setPageSetup(orientationChanges(shown, o))}
            />
          </div>
          <div className="page-dialog__row">
            <span className="page-dialog__label">Paper theme</span>
            <Segmented
              options={PAPER_THEME_OPTIONS}
              value={shown.paperTheme}
              disabled={frozen}
              onChange={(paperTheme) => setPageSetup({ paperTheme })}
            />
          </div>
        </div>
        <div className="vault-modal__footer">
          <button
            type="button"
            className="vault-btn"
            disabled={frozen}
            onClick={useAppDefault}
          >
            Use app default
          </button>
          <button
            type="button"
            className="vault-btn vault-btn--primary"
            onClick={() =>
              setDefaultPageSetup(pageSetup ?? { ...shown, enabled: false })
            }
          >
            Make app default
          </button>
        </div>
      </div>
    </div>
  );
};
