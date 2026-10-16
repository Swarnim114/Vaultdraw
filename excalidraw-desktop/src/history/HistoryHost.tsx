/**
 * The single mount point of file history inside the app shell. It owns the
 * panel state, the checkpoint dialog and a small confirmation toast, syncs the
 * native service (useHistorySync) and binds the app-level commands. The panel
 * (list, timeline, preview, restore) is one lazy chunk fetched on first open,
 * never prefetched: while history is closed nothing of it is loaded or running.
 */
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { CheckpointDialog } from "./CheckpointDialog";
import { useHistoryCommands } from "./useHistoryCommands";
import { useHistorySync } from "./useHistorySync";

import "./history.css";

import type { SaveStatus } from "../vault/types";
import type { PanelMode, PanelNotice } from "./panel/HistoryPanel";
import type { HistoryRepository, HistorySettings } from "./types";

const HistoryPanel = lazy(() => import("./panel/HistoryPanel"));

export interface HistoryHostProps {
  repository: HistoryRepository;
  vault: { handle: string; readOnly: boolean } | null;
  /** Effective (global + per-vault) settings. */
  settings: HistorySettings;
  document: { id: string; path: string; revision: string } | null;
  /** Persists pending edits (the existing flush bridge). */
  flush: () => Promise<void>;
  ownerDocument?: Document | null;
  /** Save state of the open drawing (restore is refused on conflict/deleted). */
  status?: SaveStatus;
  /** The drawing was deleted outside the editor (not exposed by every caller). */
  deleted?: boolean;
  /** Opens a vault drawing (the "Restored as <name>" toast's Open button). */
  onOpenDrawing?: (path: string) => void;
  theme?: "light" | "dark";
  /** Native save for image exports of a version. */
  onSaveFile?: (fileName: string, bytes: Uint8Array) => Promise<unknown>;
}

type Toast = {
  message: string;
  error: boolean;
  action?: PanelNotice["action"];
};
const TOAST_MS = 3000;
const TOAST_ACTION_MS = 8000;

export const HistoryHost = ({
  repository,
  vault,
  settings,
  document: activeDoc,
  flush,
  ownerDocument,
  status = "saved",
  deleted = false,
  onOpenDrawing,
  theme,
  onSaveFile,
}: HistoryHostProps) => {
  const [panelOpen, setPanelOpen] = useState(false);
  const [mode, setMode] = useState<PanelMode>("side");
  const saveRef = useRef({ status, deleted });
  saveRef.current = { status, deleted };
  const getSaveState = useCallback(() => saveRef.current, []);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useHistorySync(repository, vault, settings, activeDoc);

  const showToast = useCallback(
    (message: string, error = false, action?: Toast["action"]) => {
      if (toastTimer.current) {
        clearTimeout(toastTimer.current);
      }
      setToast({ message, error, action });
      toastTimer.current = setTimeout(
        () => setToast(null),
        action ? TOAST_ACTION_MS : TOAST_MS,
      );
    },
    [],
  );
  const notify = useCallback(
    (message: string, notice?: PanelNotice) =>
      showToast(message, notice?.error ?? false, notice?.action),
    [showToast],
  );
  useEffect(
    () => () => {
      if (toastTimer.current) {
        clearTimeout(toastTimer.current);
      }
    },
    [],
  );

  const handle = vault?.handle ?? null;
  const path = activeDoc?.path ?? null;
  const canCheckpoint = !!handle && !!path && !vault?.readOnly;

  useHistoryCommands({
    checkpoint: () => {
      if (canCheckpoint) {
        setDialogOpen(true);
      }
    },
    toggle: () => {
      setMode("side");
      setPanelOpen((open) => !open);
    },
    timeTravel: () => {
      setMode("fullscreen");
      setPanelOpen(true);
    },
  });

  // The panel and dialog belong to one drawing: closing it closes them.
  useEffect(() => {
    if (!path) {
      setPanelOpen(false);
      setDialogOpen(false);
    }
  }, [path]);

  const saveCheckpoint = useCallback(
    async (name: string, note: string) => {
      if (!handle || !path) {
        return;
      }
      await flush();
      await repository.checkpoint(handle, path, name, note);
      setDialogOpen(false);
      showToast(`Checkpoint saved: ${name}`);
    },
    [flush, handle, path, repository, showToast],
  );

  const closePanel = useCallback(() => {
    setPanelOpen(false);
    ownerDocument
      ?.querySelector<HTMLElement>(".vault-editor .excalidraw-container")
      ?.focus({ preventScroll: true });
  }, [ownerDocument]);

  return (
    <>
      {panelOpen && handle && path && (
        <Suspense fallback={null}>
          <HistoryPanel
            repository={repository}
            handle={handle}
            path={path}
            documentId={activeDoc?.id}
            onClose={closePanel}
            mode={mode}
            onModeChange={setMode}
            theme={theme}
            readOnly={vault?.readOnly}
            saveState={getSaveState}
            flush={flush}
            notify={notify}
            onOpenDrawing={onOpenDrawing}
            onSaveFile={onSaveFile}
            ownerDocument={ownerDocument}
          />
        </Suspense>
      )}
      {dialogOpen && (
        <CheckpointDialog
          onSave={saveCheckpoint}
          onCancel={() => setDialogOpen(false)}
          ownerDocument={ownerDocument}
        />
      )}
      {toast && (
        <div
          className={`vault-history-toast${
            toast.error ? " vault-history-toast--error" : ""
          }`}
          role="status"
        >
          {toast.message}
          {toast.action && (
            <button
              type="button"
              className="vault-btn vault-btn--sm"
              onClick={() => {
                toast.action?.run();
                setToast(null);
              }}
            >
              {toast.action.label}
            </button>
          )}
        </div>
      )}
    </>
  );
};
