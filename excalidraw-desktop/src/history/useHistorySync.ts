/**
 * Keeps the native history service in step with the app:
 * - `configure` on vault open and whenever the effective settings change;
 * - `opened(path | null, revision)` once per document *change*.
 *
 * `opened` is sent only after useVaultDocument has activated the new document,
 * which happens after its flush for the previous one, so the last commit of the
 * old drawing is already queued natively (leave is derived there). It is not
 * sent for a reload of the same path (outside change, conflict reload), nor for
 * an in-app move (native `moved` handles that), and never during autosave:
 * autosave does not change `document`.
 *
 * All calls run in one queue (configure always before opened) and never throw:
 * history problems must not surface in the editor.
 */
import { useEffect, useRef } from "react";

import type { HistoryRepository, HistorySettings } from "./types";

export interface HistorySyncDocument {
  id: string;
  path: string;
  revision: string;
}

interface Opened {
  handle: string;
  id: string | null;
  path: string | null;
}

export function useHistorySync(
  repository: HistoryRepository,
  vault: { handle: string } | null,
  settings: HistorySettings,
  document: HistorySyncDocument | null,
): void {
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const configured = useRef<string | null>(null);
  const last = useRef<Opened | null>(null);
  const handle = vault?.handle ?? null;

  const run = (task: () => Promise<unknown>) => {
    queue.current = queue.current.then(task).catch(() => {});
  };

  const settingsKey = JSON.stringify(settings);
  useEffect(() => {
    if (!handle) {
      configured.current = null;
      return;
    }
    const key = `${handle}|${settingsKey}`;
    if (configured.current === key) {
      return;
    }
    configured.current = key;
    run(() => repository.configure(handle, JSON.parse(settingsKey)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repository, handle, settingsKey]);

  // A document of the previous vault lingers for a tick after a vault switch.
  const doc =
    document && handle && document.id.startsWith(`${handle}:`)
      ? document
      : null;
  const docId = doc?.id ?? null;
  const docPath = doc?.path ?? null;
  const docRevision = doc?.revision ?? null;

  useEffect(() => {
    if (!handle) {
      last.current = null;
      return;
    }
    const previous = last.current;
    last.current = { handle, id: docId, path: docPath };
    if (previous && previous.handle === handle) {
      if (previous.path === docPath) {
        return; // reload of the same document
      }
      if (docId !== null && previous.id === docId) {
        return; // in-app move: same document, new path
      }
    } else if (docPath === null) {
      return; // vault just opened with nothing open
    }
    run(() => repository.opened(handle, docPath, docRevision));
    // docRevision is read once per document change on purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repository, handle, docId, docPath]);
}
