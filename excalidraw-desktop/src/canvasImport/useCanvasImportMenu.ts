/**
 * The "Import file…" item of the empty-canvas context menu. The callback is
 * stable (the editor's props memo stays intact) and reads live values.
 */
import { useCallback, useRef } from "react";

import type { HostContextMenuItem } from "@excalidraw/excalidraw/components/ContextMenu";

import { useCommandShortcut } from "../commands/useCommandShortcut";

import type { ScenePoint } from "./useCanvasImport";

export const IMPORT_FILE_COMMAND_ID = "file.importFile";
export const IMPORT_FILE_MENU_ITEM = "vault-import-file";

export const importFileMenuItems = (
  at: ScenePoint,
  onImportFile: ((at?: ScenePoint) => unknown) | undefined,
  enabled: boolean,
  shortcut: string,
): HostContextMenuItem[] =>
  enabled && onImportFile
    ? [
        {
          name: IMPORT_FILE_MENU_ITEM,
          label: "Import file…",
          shortcut,
          onSelect: () => void onImportFile(at),
        },
      ]
    : [];

export const useCanvasImportMenu = (
  onImportFile: ((at?: ScenePoint) => unknown) | undefined,
  enabled: boolean,
) => {
  const shortcut = useCommandShortcut(IMPORT_FILE_COMMAND_ID);
  const live = useRef({ onImportFile, enabled, shortcut });
  live.current = { onImportFile, enabled, shortcut };
  return useCallback((at: ScenePoint) => {
    const l = live.current;
    return importFileMenuItems(at, l.onImportFile, l.enabled, l.shortcut);
  }, []);
};
