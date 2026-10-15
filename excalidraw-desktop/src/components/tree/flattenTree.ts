import type { TreeNode } from "../../vault/treeStore";
import type { VaultEntry } from "../../vault/types";

/** One visible row of the navigator tree, in display order. */
export type TreeRow = {
  entry: VaultEntry;
  depth: number;
  expanded: boolean;
};

/** Visible rows (folders open per `expanded`), depth first. */
export function flattenTree(
  nodes: TreeNode[],
  expanded: ReadonlySet<string>,
): TreeRow[] {
  const rows: TreeRow[] = [];
  const walk = (list: TreeNode[], depth: number) => {
    for (const node of list) {
      const isOpen =
        node.entry.kind === "folder" && expanded.has(node.entry.path);
      rows.push({ entry: node.entry, depth, expanded: isOpen });
      if (isOpen && node.children) {
        walk(node.children, depth + 1);
      }
    }
  };
  walk(nodes, 0);
  return rows;
}

/**
 * Drawings inside each folder, recursively, keyed by folder path. Built from
 * the full entry list (not just the loaded tree), once per index change.
 */
export function folderDrawingCounts(
  entries: readonly VaultEntry[],
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    if (entry.kind !== "drawing") {
      continue;
    }
    let slash = entry.path.lastIndexOf("/");
    while (slash > 0) {
      const folder = entry.path.slice(0, slash);
      counts.set(folder, (counts.get(folder) ?? 0) + 1);
      slash = entry.path.lastIndexOf("/", slash - 1);
    }
  }
  return counts;
}
