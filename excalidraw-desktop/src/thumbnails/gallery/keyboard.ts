/** Gallery keyboard: pure key -> action. Chords with Ctrl/Cmd/Alt are the app's. */
export type GalleryAction =
  | { type: "move"; index: number }
  | { type: "open" }
  | { type: "parent" }
  | { type: "close" };

export interface KeyContext {
  index: number;
  count: number;
  columns: number;
  /** Rows per PageUp/PageDown. */
  pageRows: number;
}

export interface KeyLike {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
}

const clamp = (n: number, count: number) => Math.max(0, Math.min(count - 1, n));

export function moveIndex(key: string, c: KeyContext): number | null {
  const { index, count, columns } = c;
  if (count === 0) {
    return null;
  }
  switch (key) {
    case "ArrowLeft":
    case "h":
      return clamp(index - 1, count);
    case "ArrowRight":
    case "l":
      return clamp(index + 1, count);
    case "ArrowUp":
    case "k":
      return index - columns >= 0 ? index - columns : index;
    case "ArrowDown":
    case "j":
      // Only when a next row exists; a short last row takes its last tile.
      return Math.floor(index / columns) < Math.floor((count - 1) / columns)
        ? clamp(index + columns, count)
        : index;
    case "Home":
      return 0;
    case "End":
      return count - 1;
    case "PageDown":
      return clamp(index + c.pageRows * columns, count);
    case "PageUp": {
      const up = index - c.pageRows * columns;
      return up >= 0 ? up : index % columns;
    }
    default:
      return null;
  }
}

export function actionForKey(e: KeyLike, c: KeyContext): GalleryAction | null {
  if (e.ctrlKey || e.metaKey || e.altKey) {
    return null;
  }
  switch (e.key) {
    case "Enter":
      return c.count > 0 ? { type: "open" } : null;
    case "Backspace":
      return { type: "parent" };
    case "Escape":
      return { type: "close" };
    default: {
      const index = moveIndex(e.key, c);
      return index === null ? null : { type: "move", index };
    }
  }
}
