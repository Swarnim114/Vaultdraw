import type { TagCount } from "./types";

export type TagNode = {
  key: string;
  /** Full display, e.g. "DSA/Graphs". */
  display: string;
  /** Last segment of `display`. */
  label: string;
  count: number;
  children: TagNode[];
};

const node = (key: string, display: string, count: number): TagNode => ({
  key,
  display,
  label: display.slice(display.lastIndexOf("/") + 1),
  count,
  children: [],
});

/**
 * Nests the flat tag list by `/`. Keys sort parent-first, so a parent is
 * normally present; a missing one is synthesised with its largest child count.
 */
export function buildTagTree(tags: TagCount[]): TagNode[] {
  const nodes = new Map<string, TagNode>();
  const roots: TagNode[] = [];
  const synthesised = new Set<string>();
  const attach = (n: TagNode) => {
    nodes.set(n.key, n);
    const cut = n.key.lastIndexOf("/");
    if (cut < 0) {
      roots.push(n);
      return;
    }
    const parentKey = n.key.slice(0, cut);
    let parent = nodes.get(parentKey);
    if (!parent) {
      parent = node(parentKey, n.display.slice(0, cut), 0);
      synthesised.add(parentKey);
      attach(parent);
    }
    parent.children.push(n);
  };
  const sorted = [...tags].sort((a, b) => (a.tag < b.tag ? -1 : 1));
  for (const t of sorted) {
    if (!nodes.has(t.tag)) {
      attach(node(t.tag, t.display, t.count));
    }
  }
  const finish = (list: TagNode[]) => {
    list.sort((a, b) =>
      a.label.toLowerCase().localeCompare(b.label.toLowerCase()),
    );
    for (const n of list) {
      finish(n.children);
      if (synthesised.has(n.key)) {
        n.count = Math.max(...n.children.map((c) => c.count));
      }
    }
  };
  finish(roots);
  return roots;
}
