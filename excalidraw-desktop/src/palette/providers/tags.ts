/** Palette provider: "Tag: #DSA/graphs (5)" for every tag in the open vault. */
import { tagQuery, type TagCount } from "../../tags/types";

import type { PaletteItem, PaletteProvider } from "../types";

export interface TagsProviderDeps {
  tags(): readonly TagCount[];
  /** Applies the `tag:#key` filter in the navigator search. */
  apply(key: string): void;
}

export function createTagsProvider({
  tags,
  apply,
}: TagsProviderDeps): PaletteProvider {
  return {
    id: "tags",
    items(): PaletteItem[] {
      return tags().map(({ tag, display, count }) => ({
        key: `tag:${tag}`,
        title: `Tag: #${display} (${count})`,
        group: "Tags",
        keywords: [tagQuery(tag), "tag", "filter"],
        run: () => apply(tag),
      }));
    },
  };
}
