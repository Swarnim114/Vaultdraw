/**
 * Tabs: which view a mounting editor starts with. After an outside change or
 * a conflict "Reload" the same drawing mounts again under a new document id;
 * the previous editor is still mounted during that render, so its live view
 * wins over the last captured one (which is only as new as the last switch).
 */
import type { ViewState } from "./types";

export type MountedDoc = { id: string; path: string };

export const pickRestoreView = (o: {
  /** The editor mounted before this document, if any. */
  prev: MountedDoc | null;
  docId: string;
  path: string;
  /** Live view of an editor by document id; null when it is gone. */
  readLive: (docId: string) => ViewState | null;
  /** The tab's last captured view. */
  stored: ViewState | undefined;
}): ViewState | undefined => {
  const { prev } = o;
  if (prev && prev.id !== o.docId && prev.path === o.path) {
    return o.readLive(prev.id) ?? o.stored;
  }
  return o.stored;
};
