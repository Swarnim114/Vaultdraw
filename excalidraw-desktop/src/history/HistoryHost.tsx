/**
 * The single mount point of file history inside the app shell. It owns the
 * panel state, the checkpoint dialog and a small confirmation toast, syncs the
 * native service (useHistorySync) and binds the app-level commands. The panel
 * is a static import on purpose: it is tiny, and a separate lazy chunk for it
 * measurably slowed the vault-open paint (see perf notes in the commit).
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { CheckpointDialog } from "./CheckpointDialog";
import HistoryPanel from "./panel/HistoryPanel";
import { useHistoryCommands } from "./useHistoryCommands";
import { useHistorySync } from "./useHistorySync";

import "./history.css";

import type { HistoryRepository, HistorySettings } from "./types";

export interface HistoryHostProps {
  repository: HistoryRepository;
  vault: { handle: string; readOnly: boolean } | null;
  /** Effective (global + per-vault) settings. */
  settings: HistorySettings;
  document: { id: string; path: string; revision: string } | null;
  /** Persists pending edits (the existing flush bridge). */
  flush: () => Promise<void>;
  ownerDocument?: Document | null;
}

type Toast = { message: string; error: boolean };
const TOAST_MS = 3000;

export const HistoryHost = ({
  repository,
  vault,
  settings,
  document: activeDoc,
  flush,
  ownerDocument,
}: HistoryHostProps) => {
  const [panelOpen, setPanelOpen] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useHistorySync(repository, vault, settings, activeDoc);

  const showToast = useCallback((message: string, error = false) => {
    if (toastTimer.current) {
      clearTimeout(toastTimer.current);
    }
    setToast({ message, error });
    toastTimer.current = setTimeout(() => setToast(null), TOAST_MS);
  }, []);
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
    toggle: () => setPanelOpen((open) => !open),
    timeTravel: () => setPanelOpen(true),
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
        <HistoryPanel
          repository={repository}
          handle={handle}
          path={path}
          onClose={closePanel}
        />
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
        </div>
      )}
    </>
  );
};
