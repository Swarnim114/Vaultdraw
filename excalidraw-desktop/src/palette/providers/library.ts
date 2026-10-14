/**
 * "Insert: <name>" palette entries (library items, inserted on the canvas). The library feature supplies a
 * LibraryItemSource; until it does, getSource returns null and nothing shows.
 */
import type { PaletteItem, PaletteProvider } from "../types";

export interface LibraryItemSource {
  list(): readonly {
    id: string;
    name: string;
    keywords?: readonly string[];
  }[];
  insert(id: string): void | Promise<void>;
}

export function createLibraryItemsProvider(
  getSource: () => LibraryItemSource | null,
): PaletteProvider {
  return {
    id: "library-items",
    items(): readonly PaletteItem[] {
      const source = getSource();
      if (!source) {
        return [];
      }
      return source.list().map((entry) => ({
        key: `library:${entry.id}`,
        title: `Insert: ${entry.name}`,
        keywords: entry.keywords,
        group: "Library",
        run: () => source.insert(entry.id),
      }));
    },
  };
}
