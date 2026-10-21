import { useEffect, useState } from "react";

import "./LoadingLine.css";

/** A load shorter than this never shows the line (no flash on quick switches). */
export const LOADING_LINE_DELAY_MS = 150;

/** True once `active` has stayed true for `delayMs`; false again as soon as it ends. */
export const useDelayedFlag = (
  active: boolean,
  delayMs = LOADING_LINE_DELAY_MS,
): boolean => {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!active) {
      setShown(false);
      return;
    }
    const timer = setTimeout(() => setShown(true), delayMs);
    return () => clearTimeout(timer);
  }, [active, delayMs]);
  return shown;
};

/** A 2 px progress line along the top of the editor, only for slow loads. */
export const LoadingLine = ({ active }: { active: boolean }) =>
  useDelayedFlag(active) ? (
    <div
      className="vault-editor-loading-line"
      role="progressbar"
      aria-label="Loading drawing"
    />
  ) : null;
