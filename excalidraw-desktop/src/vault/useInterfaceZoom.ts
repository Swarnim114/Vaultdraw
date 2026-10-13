/**
 * Interface zoom: applies the `zoom` preference to the webview and handles
 * Cmd/Ctrl+Shift +/-/0. Mount once in the app shell.
 */
import { useEffect, useState } from "react";

import {
  getPreferences,
  subscribePreferences,
  updatePreferences,
} from "./preferences";
import {
  applyWebviewZoom,
  clampZoom,
  DEFAULT_ZOOM,
  installZoomShortcuts,
  stepZoom,
} from "./zoom";

export const useInterfaceZoom = (doc: Document | null, win: Window | null) => {
  const [zoom, setZoom] = useState(() => getPreferences(win).zoom);

  useEffect(
    () =>
      subscribePreferences(() => {
        setZoom(getPreferences(win).zoom);
      }),
    [win],
  );

  useEffect(() => {
    void applyWebviewZoom(clampZoom(zoom));
  }, [zoom]);

  useEffect(() => {
    if (!doc) {
      return;
    }
    const isMac = /Mac/.test(doc.defaultView?.navigator.userAgent ?? "");
    return installZoomShortcuts(
      doc,
      {
        onCommand: (cmd) => {
          const current = getPreferences(win).zoom;
          updatePreferences(
            {
              zoom:
                cmd === "reset"
                  ? DEFAULT_ZOOM
                  : stepZoom(current, cmd === "in" ? 1 : -1),
            },
            win,
          );
        },
      },
      isMac,
    );
  }, [doc, win]);
};
