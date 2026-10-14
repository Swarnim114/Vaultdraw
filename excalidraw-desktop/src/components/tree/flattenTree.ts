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
