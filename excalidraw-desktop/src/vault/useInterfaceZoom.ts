/**
 * Interface zoom: applies the `zoom` preference to the webview. The keyboard
 * shortcuts are the view.zoom* commands (see commands/useAppCommands.ts),
 * which call `runZoomCommand`. Mount the hook once in the app shell.
 */
import { useEffect, useState } from "react";

import {
  getPreferences,
  subscribePreferences,
  updatePreferences,
} from "./preferences";
import { applyWebviewZoom, clampZoom, nextZoom } from "./zoom";

import type { ZoomCommand } from "./zoom";

/** Step or reset the zoom preference (what Cmd+Shift +/-/0 do). */
export const runZoomCommand = (
  command: ZoomCommand,
  win: Window | null,
): void => {
  updatePreferences({ zoom: nextZoom(getPreferences(win).zoom, command) }, win);
};

export const useInterfaceZoom = (win: Window | null) => {
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
};
