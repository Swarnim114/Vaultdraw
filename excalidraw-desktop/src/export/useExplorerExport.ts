/** Navigator "Export as PNG/SVG…" and "Save a copy…" for VaultApp. */

import { useCallback, useRef } from "react";

import { loadExportOptions } from "../editor/exportOptions";

import { exportDrawingFromVault } from "./exportFromFile";

import type { ExplorerExportFormat } from "./exportFromFile";

import type { VaultInfo, VaultRepository } from "../vault/types";

type Alert = { message: string; type: "error" | "info" } | null;

/** Show "Exporting…" only when a render is slow enough to notice. */
export const BUSY_NOTICE_MS = 200;

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
    const notice = win.setTimeout(() => {
      noticeShown = true;
      setAlert({ message: `Exporting ${name}…`, type: "info" });
    }, BUSY_NOTICE_MS);
    const endNotice = () => {
      win.clearTimeout(notice);
      if (noticeShown) {
        noticeShown = false;
        setAlert(null);
      }
    };
    try {
      await flushIfOpen(path);
      const { scale, background, embedScene } = loadExportOptions();
      await exportDrawingFromVault({
        repository,
        handle: vault.handle,
        path,
        format,
        options: { scale, background, embedScene, dark },
        win,
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
