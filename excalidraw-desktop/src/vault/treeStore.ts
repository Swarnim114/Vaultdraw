import { joinPath, type VaultEntry, type VaultRepository } from "./types";

export { joinPath };

export type TreeNode = {
  entry: VaultEntry;
  children?: TreeNode[];
  loaded?: boolean;
  loading?: boolean;
  error?: string | null;
};

export const MAX_SEARCH_RESULTS = 100;

/** Case-insensitive filename/path substring search over an array of paths. */
export function searchPaths(entries: string[], query: string): string[] {
  const q = query.trim().toLowerCase();
  if (!q) {
    return [];
  }
  return entries.filter((entry) => entry.toLowerCase().includes(q));
}

/** Case-insensitive search over VaultEntry items, matching either path or name. */
export function searchEntries(
  entries: VaultEntry[],
  query: string,
): VaultEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) {
    return [];
  }
  return entries.filter(
    (entry) =>
      entry.path.toLowerCase().includes(q) ||
      entry.name.toLowerCase().includes(q),
  );
}

/** Duplicate naming: "a.excalidraw" -> "a copy.excalidraw", "a copy" -> "a copy 2". */
export function duplicateName(path: string): string {
  const slash = path.lastIndexOf("/");
  const parent = slash >= 0 ? path.slice(0, slash) : "";
  const file = slash >= 0 ? path.slice(slash + 1) : path;
  const base = file.endsWith(".excalidraw")
    ? file.slice(0, -".excalidraw".length)
    : file;
  const copyBase = / copy( \d+)?$/.test(base)
    ? base.replace(/ copy( \d+)?$/, (m) =>
        m === " copy" ? " copy 2" : ` copy ${Number(m.split(" ")[2]) + 1}`,
      )
    : `${base} copy`;
  return joinPath(parent, `${copyBase}.excalidraw`);
}

export function getParentPath(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash >= 0 ? path.slice(0, slash) : "";
}

export function getBaseName(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash >= 0 ? path.slice(slash + 1) : path;
}

export function getCleanDrawingName(name: string): string {
  let clean = name.trim();
  if (clean.toLowerCase().endsWith(".excalidraw")) {
    clean = clean.slice(0, -".excalidraw".length);
  }
  return clean;
}

export function validateEntryName(
  name: string,
  kind: "folder" | "drawing",
): { valid: boolean; error?: string } {
  const trimmed = name.trim();
  if (!trimmed) {
    return { valid: false, error: "Name cannot be empty" };
  }
  if (trimmed.length > 255) {
    return { valid: false, error: "Name is too long (maximum 255 characters)" };
  }
  if (
    trimmed.includes("/") ||
    trimmed.includes("\\") ||
    trimmed.includes(":") ||
    trimmed.includes("\0")
  ) {
    return { valid: false, error: "Name cannot contain slashes or colons" };
  }
  if (trimmed === "." || trimmed === "..") {
    return { valid: false, error: "Name cannot be '.' or '..'" };
  }
  if (trimmed.toLowerCase() === ".excalidraw-vault") {
    return { valid: false, error: "Name is reserved by the application" };
  }
  if (kind === "folder" && trimmed.toLowerCase().endsWith(".excalidraw")) {
    return {
      valid: false,
      error: "Folder names should not end in .excalidraw",
    };
  }
  return { valid: true };
}

export function isMoveAllowed(
  sourcePath: string,
  targetParentPath: string,
): { allowed: boolean; reason?: string } {
  if (sourcePath === "") {
    return { allowed: false, reason: "Cannot move vault root" };
  }
  if (sourcePath === targetParentPath) {
    return { allowed: false, reason: "Cannot move entry into itself" };
  }
  const prefix = `${sourcePath}/`;
  if (targetParentPath.startsWith(prefix)) {
    return {
      allowed: false,
      reason: "Cannot move a folder into its own subfolder",
    };
  }
  const currentParent = getParentPath(sourcePath);
  if (currentParent === targetParentPath) {
    return { allowed: false, reason: "Item is already in this folder" };
  }
  return { allowed: true };
}

/**
 * Crawls vault directory metadata recursively for background search indexing.
 * Cancellable via AbortSignal.
 */
export async function scanVaultMetadata(
  repository: VaultRepository,
  handle: string,
  signal?: AbortSignal,
  onProgress?: (entries: VaultEntry[]) => void,
): Promise<VaultEntry[]> {
  const all: VaultEntry[] = [];
  const queue: string[] = [""];

  while (queue.length > 0) {
    if (signal?.aborted) {
      break;
    }
    const dir = queue.shift()!;
    try {
      const items = await repository.listDirectory(handle, dir);
      for (const item of items) {
        if (signal?.aborted) {
          break;
        }
        all.push(item);
        if (item.kind === "folder") {
          queue.push(item.path);
        }
      }
      if (!signal?.aborted) {
        onProgress?.(all);
      }
    } catch {
      // ignore unreadable/moved directories during background scan
    }
  }

  if (signal?.aborted) {
    return [];
  }

  return all;
}

/**
 * Builds a hierarchical tree node from a map of directory entries.
 */
export function buildTree(
  directoryMap: Map<string, VaultEntry[]>,
  currentPath = "",
): TreeNode[] {
  const entries = directoryMap.get(currentPath) ?? [];
  return entries.map((entry) => {
    if (entry.kind === "folder") {
      const children = directoryMap.has(entry.path)
        ? buildTree(directoryMap, entry.path)
        : undefined;
      return {
        entry,
        children,
        loaded: directoryMap.has(entry.path),
      };
    }
    return {
      entry,
    };
  });
}
