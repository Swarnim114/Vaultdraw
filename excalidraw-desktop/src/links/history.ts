/** Back/forward through link jumps (Obsidian-style), in memory only. */
export type HistoryEntry = { path: string; elementId?: string };

const same = (a: HistoryEntry, b: HistoryEntry) =>
  a.path === b.path && a.elementId === b.elementId;

export class NavHistory {
  private stack: HistoryEntry[] = [];
  private at = -1;

  constructor(private readonly cap = 100) {}

  get current(): HistoryEntry | null {
    return this.stack[this.at] ?? null;
  }
  get canBack() {
    return this.at > 0;
  }
  get canForward() {
    return this.at >= 0 && this.at < this.stack.length - 1;
  }

  /**
   * Record that `entry` is now showing. A no-op when it is already the current
   * one (so opening the entry `back()` returned does not push again); drops the
   * forward entries otherwise.
   */
  visit(entry: HistoryEntry): void {
    const cur = this.current;
    if (cur && same(cur, entry)) {
      return;
    }
    // Re-opening the same drawing without an element refines the current entry.
    if (cur && cur.path === entry.path && entry.elementId === undefined) {
      return;
    }
    this.stack.length = this.at + 1;
    this.stack.push({ ...entry });
    if (this.stack.length > this.cap) {
      this.stack.shift();
    }
    this.at = this.stack.length - 1;
  }

  back(): HistoryEntry | null {
    return this.canBack ? { ...this.stack[--this.at] } : null;
  }

  forward(): HistoryEntry | null {
    return this.canForward ? { ...this.stack[++this.at] } : null;
  }

  /** A moved/renamed drawing keeps its place in the history. */
  rename(from: string, to: string): void {
    for (const e of this.stack) {
      if (e.path === from) {
        e.path = to;
      } else if (e.path.startsWith(`${from}/`)) {
        e.path = `${to}${e.path.slice(from.length)}`;
      }
    }
  }

  clear(): void {
    this.stack = [];
    this.at = -1;
  }
}
