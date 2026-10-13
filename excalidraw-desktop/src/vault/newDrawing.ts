/**
 * Where a new drawing goes. `setting` is the effective
 * files.new_drawing_folder ("" = unset: next to the open drawing).
 */
import { getParentPath } from "./treeStore";

import type { VaultRepository } from "./types";

export const resolveNewDrawingParent = (
  setting: string,
  activePath: string | null,
): string => setting || (activePath ? getParentPath(activePath) : "");

/** "a/b/c" -> ["a", "a/b", "a/b/c"] */
export const folderChain = (path: string): string[] => {
  const parts = path.split("/").filter(Boolean);
  return parts.map((_, i) => parts.slice(0, i + 1).join("/"));
};

/**
 * Creates `path` and any missing parents (the native create_folder is not
 * recursive and refuses existing folders). Returns the folders it created.
 * One listing per level; nothing is created when the folder already exists.
 */
export async function ensureFolder(
  repository: VaultRepository,
  handle: string,
  path: string,
): Promise<string[]> {
  const created: string[] = [];
  for (const folder of folderChain(path)) {
    try {
      await repository.listDirectory(handle, folder);
    } catch {
      await repository.createFolder(handle, folder);
      created.push(folder);
    }
  }
  return created;
}
