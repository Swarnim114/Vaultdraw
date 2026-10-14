/** Navigator "Export as PNG/SVG…" and "Save a copy…" for VaultApp. */

import { useCallback, useRef } from "react";

import { loadExportOptions } from "../editor/exportOptions";

import { exportDrawingFromVault } from "./exportFromFile";

import type { ExplorerExportFormat } from "./exportFromFile";

import type { VaultInfo, VaultRepository } from "../vault/types";

type Alert = { message: string; type: "error" | "info" } | null;

/** Show "Exporting…" only when a render is slow enough to notice. */
export const BUSY_NOTICE_MS = 200;
/**
 * Files this big render in one long main-thread task (~300 ms for 2000
 * elements), during which a timer can't fire: show the notice up front and
 * let it paint first.
 */
export const LARGE_DRAWING_CHARS = 256 * 1024;

const nextPaint = (win: Window) =>
  new Promise<void>((resolve) =>
    win.requestAnimationFrame(() => win.setTimeout(resolve, 0)),
  );

export const useExplorerExport = (input: {
  repository: VaultRepository;
  vault: VaultInfo | null;
  win: (Window & typeof globalThis) | null;
  /** Export dark mode follows the app theme, as in the export dialog. */
  dark: boolean;
  /** Saves pending edits when `path` is the open drawing (exports read disk). */
  flushIfOpen: (path: string) => Promise<void>;
  setAlert: (alert: Alert) => void;
}) => {
  const latest = useRef(input);
  latest.current = input;
  const running = useRef(false);

  return useCallback(async (path: string, format: ExplorerExportFormat) => {
    const { repository, vault, win, dark, flushIfOpen, setAlert } =
      latest.current;
    if (!vault || !win || running.current) {
      return;
    }
    running.current = true;
    const name = path.slice(path.lastIndexOf("/") + 1);
    // Busy notice for slow renders only: never while the save dialog is up.
    let noticeShown = false;
    const showNotice = () => {
      win.clearTimeout(notice);
      if (!noticeShown) {
        noticeShown = true;
        setAlert({ message: `Exporting ${name}…`, type: "info" });
      }
    };
    const notice = win.setTimeout(showNotice, BUSY_NOTICE_MS);
    const endNotice = () => {
      win.clearTimeout(notice);
      if (noticeShown) {
        noticeShown = false;
        setAlert(null);
      }
    };
    try {
      await flushIfOpen(path);
      const { scale, background, embedScene, pattern } = loadExportOptions();
      await exportDrawingFromVault({
        repository,
        handle: vault.handle,
        path,
        format,
        options: { scale, background, embedScene, pattern, dark },
        win,
        beforeRender: async (json) => {
          if (json.length > LARGE_DRAWING_CHARS) {
            showNotice();
            await nextPaint(win);
          }
        },
        onRendered: endNotice,
      });
      endNotice();
    } catch (err) {
      win.clearTimeout(notice);
      setAlert({
        message: `Failed to export ${name}: ${
          err instanceof Error ? err.message : String(err)
        }`,
        type: "error",
      });
    } finally {
      running.current = false;
    }
  }, []);
};
