/**
 * The always-loaded part of the gallery: command handlers, open folder state,
 * item list. The view is a lazy chunk, not requested until first opened.
 */
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { registerCommandHandlers } from "../../commands/handlerRegistry";
import { THUMBNAIL_COMMAND_IDS as ID } from "../../commands/thumbnailCommands";
import { isInTemplatesFolder } from "../../templates/listTemplates";
import { getParentPath } from "../../vault/treeStore";
import { sortEntries, type SortOrder } from "../../vault/sortOrder";

import { onGalleryRequest } from "./openRequest";

import type { VaultEntry } from "../../vault/types";

const GalleryView = lazy(() => import("./GalleryView"));

const LOADING_STYLE = {
  position: "absolute",
  inset: 0,
  background: "var(--vault-bg, #fff)",
  zIndex: 5,
} as const;

export interface GalleryHostProps {
  /** Open vault handle; null closes the gallery and unbinds the commands. */
  handle: string | null;
  vaultName: string;
  directoryMap: Map<string, VaultEntry[]>;
  loadDirectory: (path: string) => unknown;
  sort: SortOrder;
  templatesFolder: string;
  activePath: string | null;
  onOpenDrawing: (path: string) => unknown;
  /** The editor is hidden and frozen while this is true. */
  onOpenChange: (open: boolean) => void;
  /** Called after Escape closed the gallery: focus the canvas. */
  onClosed: () => void;
}

export function GalleryHost({
  handle,
  vaultName,
  directoryMap,
  loadDirectory,
  sort,
  templatesFolder,
  activePath,
  onOpenDrawing,
  onOpenChange,
  onClosed,
}: GalleryHostProps) {
  const [folder, setFolder] = useState<string | null>(null);
  // The folder we just left via Backspace: selected first in the parent.
  const [from, setFrom] = useState<string | null>(null);
  const live = useRef({ activePath, loadDirectory, onOpenDrawing, onClosed });
  live.current = { activePath, loadDirectory, onOpenDrawing, onClosed };
  const open = folder !== null;

  const show = useCallback(
    (target: string, comingFrom: string | null = null) => {
      void live.current.loadDirectory(target);
      setFrom(comingFrom);
      setFolder(target);
    },
    [],
  );

  const close = useCallback(() => {
    setFolder(null);
    live.current.onClosed();
  }, []);

  useEffect(() => {
    if (!handle) {
      setFolder(null);
    }
  }, [handle]);

  const openedBefore = useRef(false);
  useEffect(() => {
    if (open || openedBefore.current) {
      openedBefore.current = open;
      onOpenChange(open);
    }
  }, [open, onOpenChange]);

  useEffect(() => {
    if (!handle) {
      return;
    }
    const currentFolder = () => getParentPath(live.current.activePath ?? "");
    const unbindRequest = onGalleryRequest((f) => show(f));
    const unbind = registerCommandHandlers({
      [ID.galleryOpen]: () => show(currentFolder()),
      [ID.galleryToggle]: () => (open ? close() : show(currentFolder())),
    });
    return () => {
      unbind();
      unbindRequest();
    };
  }, [handle, open, show, close]);

  const entries = folder === null ? undefined : directoryMap.get(folder);
  const items = useMemo(
    () =>
      sortEntries(entries ?? [], sort).filter(
        (e) => !isInTemplatesFolder(e.path, templatesFolder),
      ),
    [entries, sort, templatesFolder],
  );

  if (folder === null || !handle) {
    return null;
  }
  return (
    <Suspense
      fallback={
        <div className="vd-gallery" style={LOADING_STYLE} aria-busy="true" />
      }
    >
      <GalleryView
        key={folder}
        folder={folder}
        vaultName={vaultName}
        items={items}
        initialPath={from}
        onOpenDrawing={(path) => {
          setFolder(null);
          void live.current.onOpenDrawing(path);
        }}
        onOpenFolder={(path) => show(path)}
        onParent={() =>
          folder ? show(getParentPath(folder), folder) : undefined
        }
        onClose={close}
      />
    </Suspense>
  );
}
