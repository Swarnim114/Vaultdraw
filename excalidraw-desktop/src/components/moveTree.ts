import { getBaseName } from "../vault/treeStore";

import { flattenTree } from "./tree/flattenTree";

import type { TreeNode } from "../vault/treeStore";
import type { TreeRow } from "./tree/flattenTree";

/** Nested folder nodes for the Move dialog, from flat folder paths. The vault root ("") is the single top node. */
export function buildFolderTree(folders: readonly string[]): TreeNode[] {
  const nodes = new Map<string, TreeNode>();
  const make = (path: string): TreeNode => {
    let node = nodes.get(path);
    if (!node) {
      node = {
        entry: {
          path,
          name: path === "" ? "Vault root" : getBaseName(path),
          kind: "folder",
          modifiedAt: 0,
          size: 0,
        },
        children: [],
      };
      nodes.set(path, node);
    }
    return node;
  };
  const root = make("");
  for (const folder of [...new Set(folders)].sort((a, b) =>
    a.localeCompare(b),
  )) {
    if (folder === "") {
      continue;
    }
    // Every ancestor exists even if the list only names the leaf.
    let parent = root;
    let path = "";
    for (const segment of folder.split("/")) {
      path = path === "" ? segment : `${path}/${segment}`;
      const known = nodes.has(path);
      const node = make(path);
      if (!known) {
        parent.children!.push(node);
      }
      parent = node;
    }
  }
  return [root];
}

/** Paths whose name matches the type-ahead plus all their ancestors. */
export function matchingFolderPaths(
  folders: readonly string[],
  query: string,
): Set<string> {
  const needle = query.trim().toLowerCase();
  const keep = new Set<string>([""]);
  if (needle === "") {
    return keep;
  }
  for (const folder of folders) {
    if (folder !== "" && getBaseName(folder).toLowerCase().includes(needle)) {
      let path = folder;
      while (path !== "") {
        keep.add(path);
        const slash = path.lastIndexOf("/");
        path = slash < 0 ? "" : path.slice(0, slash);
      }
    }
  }
  return keep;
}

export type MoveRow = TreeRow & { hasChildren: boolean };

/**
 * Rows the Move dialog shows: the whole tree with `expanded` folders open, or,
 * while a type-ahead is active, only matches and their ancestors, all open.
 */
export function moveRows(
  folders: readonly string[],
  expanded: ReadonlySet<string>,
  query: string,
): MoveRow[] {
  const filtering = query.trim() !== "";
  const keep = filtering ? matchingFolderPaths(folders, query) : null;
  const prune = (list: TreeNode[]): TreeNode[] =>
    list
      .filter((n) => !keep || keep.has(n.entry.path))
      .map((n) => ({ ...n, children: prune(n.children ?? []) }));
  const full = buildFolderTree(folders);
  const nodes = keep ? prune(full) : full;
  const open = keep ?? expanded;
  const hasKids = new Map<string, boolean>();
  const walk = (list: TreeNode[]) =>
    list.forEach((n) => {
      hasKids.set(n.entry.path, (n.children?.length ?? 0) > 0);
      walk(n.children ?? []);
    });
  walk(nodes);
  return flattenTree(nodes, open).map((row) => ({
    ...row,
    hasChildren: hasKids.get(row.entry.path) ?? false,
  }));
}
