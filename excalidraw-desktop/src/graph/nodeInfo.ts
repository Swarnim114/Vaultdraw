/** What the hover card shows about one node (global node id). */
import { FLAG_TAG, FLAG_UNRESOLVED } from "./types";

import type { GraphData } from "./types";

export interface NodeInfo {
  kind: "drawing" | "ghost" | "tag";
  name: string;
  path: string | null;
  folder: string;
  tags: string[];
  /** Links to other nodes. */
  links: number;
  /** Drawings linking here (drawings only). */
  backlinks: number;
}

export function describeNode(g: GraphData, i: number): NodeInfo {
  const f = g.flags[i];
  const kind = f & FLAG_TAG ? "tag" : f & FLAG_UNRESOLVED ? "ghost" : "drawing";
  const tags: string[] = [];
  if (kind === "drawing") {
    for (const j of g.neighbours(i)) {
      if (g.flags[j] & FLAG_TAG) {
        tags.push(g.label(j));
      }
    }
  }
  return {
    kind,
    name: g.label(i),
    path: g.path(i),
    folder: g.folderName(g.folder[i]),
    tags,
    links: g.outDeg[i],
    backlinks: kind === "drawing" ? g.inDeg[i] : 0,
  };
}
