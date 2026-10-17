/**
 * The single mount point of file history inside the app shell. It owns the
 * panel state, the checkpoint dialog and a small confirmation toast, syncs the
 * native service (useHistorySync) and binds the app-level commands. The panel
 * (list, timeline, preview, restore) is one lazy chunk fetched on first open,
 * never prefetched: while history is closed nothing of it is loaded or running.
 */
import {
  lazy,
  memo,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { ConfirmModal } from "../components/ConfirmModal";
import { errorMessage } from "../vault/types";

import { CheckpointDialog } from "./CheckpointDialog";
import { publishHistoryBridge } from "./historyBridge";
import {
  deleteAllConfirm,
  drawingName,
  GIT_EXCLUDED_MESSAGE,
} from "./historyConfirms";
import { useHistoryCommands } from "./useHistoryCommands";
import { useHistoryStatus } from "./useHistoryStatus";
import { useHistorySync } from "./useHistorySync";

import "./history.css";

import type { SaveStatus } from "../vault/types";
import type { PanelMode, PanelNotice } from "./panel/HistoryPanel";
import type { HistoryRepository, HistorySettings } from "./types";

const HistoryPanel = lazy(() => import("./panel/HistoryPanel"));

export interface HistoryHostProps {
  repository: HistoryRepository;
  vault: { handle: string; readOnly: boolean; path?: string } | null;
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

const HistoryHostImpl = ({
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
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false);
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
  const readOnly = vault?.readOnly ?? false;
  const canCheckpoint = !!handle && !!path && !readOnly;

  // One status read per vault (and after an action): only the git state is
  // used here, to offer "Exclude history from git" in git vaults.
  const { status: vaultStatus, refresh: refreshStatus } = useHistoryStatus(
    repository,
    handle,
  );
  const canExclude =
    !!handle && !readOnly && !!vaultStatus?.gitRepo && !vaultStatus.gitExcluded;

  useEffect(() => {
    publishHistoryBridge(
      handle ? { repository, handle, path, readOnly } : null,
    );
    return () => publishHistoryBridge(null);
  }, [repository, handle, path, readOnly]);

  const excludeFromGit = useCallback(async () => {
    if (!handle) {
      return;
    }
    try {
      await repository.excludeFromGit(handle);
      showToast(GIT_EXCLUDED_MESSAGE);
    } catch (cause) {
      showToast(errorMessage(cause), true);
    }
    void refreshStatus();
  }, [handle, repository, showToast, refreshStatus]);

  const deleteAll = useCallback(async () => {
    setConfirmDeleteAll(false);
    if (!handle || !path) {
      return;
    }
    try {
      await repository.deleteAll(handle, path);
      showToast(`Deleted all history of ${drawingName(path)}`);
    } catch (cause) {
      showToast(errorMessage(cause), true);
    }
    void refreshStatus();
  }, [handle, path, repository, showToast, refreshStatus]);

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
    deleteAll:
      handle && path && !readOnly ? () => setConfirmDeleteAll(true) : undefined,
    excludeFromGit: canExclude ? () => void excludeFromGit() : undefined,
  });

  // The panel and dialog belong to one drawing: closing it closes them.
  useEffect(() => {
    if (!path) {
      setPanelOpen(false);
      setDialogOpen(false);
      setConfirmDeleteAll(false);
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
            vaultKey={vault?.path}
            highlightChanges={settings.highlightChanges}
            onGitChange={() => void refreshStatus()}
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
      {confirmDeleteAll && path && (
        <ConfirmModal
          {...deleteAllConfirm(path)}
          onConfirm={() => void deleteAll()}
          onCancel={() => setConfirmDeleteAll(false)}
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

/** Memoised: re-renders only when a prop changes (the shell re-renders often). */
export const HistoryHost = memo(HistoryHostImpl);
