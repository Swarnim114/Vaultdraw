/**
 * The unified command palette (Cmd+P): drawings and provider items (commands,
 * editor actions, themes, pens, ...) in one ranked list, one search. A leading
 * ">" restricts it to items; Tab drills into an item's family ("Theme: ").
 * Items are collected once when the palette opens (and again after a
 * Mod+Enter run); everything is prepared once and ranked synchronously per
 * keystroke (see palette/rank.ts).
 */
import {
  memo,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";

import { chordFromEvent } from "../commands/keys";
import { getCommand } from "../commands/commands";
import { effectiveKeys } from "../commands/keymap";
import { useHotkeyOverrides } from "../commands/useCommands";
import { focusCanvasIfIdle } from "../palette/focus";
import { prepareDrawings, prepareItems, rankRows } from "../palette/rank";
import { getRecent, recordRecent } from "../palette/recent";
import { errorMessage } from "../vault/types";

import { IconDrawing } from "./Icons";

import "./QuickSwitcher.css";

import type { RankedRow } from "../palette/rank";
import type { PaletteItem } from "../palette/types";
import type { Platform } from "../commands/types";
import type { IndexStatus, VaultSearch } from "../search/types";

const SWITCHER_ID = "palette.quickSwitcher";
const EXTENSION = /\.excalidraw$/i;
const DRILL_SEPARATOR = ": ";

export interface QuickSwitcherProps {
  /** Source of the drawing names; null = use `fallbackPaths`. */
  search: Pick<VaultSearch, "listNames" | "subscribe"> | null;
  handle: string;
  /** Used when there is no search backend. */
  fallbackPaths?: readonly string[];
  /** Entries from the palette providers (collectPaletteItems); called on open and again after a Mod+Enter run. */
  collectItems(): readonly PaletteItem[];
  platform: Platform;
  onOpenDrawing(path: string): void;
  /** Enter: the shell closes the palette, then runs it. Mod+Enter (keepOpen): the shell runs it in place. */
  onRunItem(item: PaletteItem, keepOpen: boolean): void;
  /** Esc, backdrop click, or the palette's own shortcut. */
  onClose(): void;
  ownerDocument?: Document | null;
}

/** Wrap matched characters of text[from, to) in <mark>. */
function highlight(
  text: string,
  from: number,
  to: number,
  positions: ReadonlySet<number>,
) {
  if (positions.size === 0) {
    return text.slice(from, to);
  }
  const out: React.ReactNode[] = [];
  let i = from;
  while (i < to) {
    const marked = positions.has(i);
    let j = i + 1;
    while (j < to && positions.has(j) === marked) {
      j++;
    }
    const part = text.slice(i, j);
    out.push(marked ? <mark key={i}>{part}</mark> : part);
    i = j;
  }
  return out;
}

interface RowViewProps {
  id: string;
  row: RankedRow;
  active: boolean;
  index: number;
  onHover(index: number): void;
  onPick(index: number): void;
}

const RowView = memo(
  ({ id, row, active, index, onHover, onPick }: RowViewProps) => {
    const positions = new Set(row.positions);
    let body: React.ReactNode;
    if (row.kind === "drawing") {
      const { path } = row.drawing;
      const slash = path.lastIndexOf("/");
      const nameEnd = path.replace(EXTENSION, "").length;
      body = (
        <>
          <span className="vault-quick__icon">
            <IconDrawing />
          </span>
          <span className="vault-quick__name">
            {highlight(path, slash + 1, nameEnd, positions)}
          </span>
          {slash > 0 && (
            <span className="vault-quick__muted">
              {highlight(path, 0, slash, positions)}
            </span>
          )}
        </>
      );
    } else {
      const { item } = row.entry;
      body = (
        <>
          <span className="vault-quick__icon">{item.icon}</span>
          <span className="vault-quick__name">
            {highlight(item.title, 0, item.title.length, positions)}
          </span>
          <span className="vault-quick__muted">{item.group}</span>
          {item.checked && (
            <span
              className="vault-quick__check"
              role="img"
              aria-label="Current"
            >
              ✓
            </span>
          )}
          {item.shortcut && (
            <kbd className="vault-quick__keys">{item.shortcut}</kbd>
          )}
        </>
      );
    }
    return (
      <div
        id={id}
        role="option"
        aria-selected={active}
        className={`vault-quick__row${
          active ? " vault-quick__row--active" : ""
        }`}
        onMouseMove={() => onHover(index)}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => onPick(index)}
      >
        {body}
      </div>
    );
  },
);
RowView.displayName = "RowView";

interface Names {
  paths: readonly string[];
  status: IndexStatus | null;
  error: string | null;
}

function useDrawingNames(
  search: QuickSwitcherProps["search"],
  handle: string,
  fallbackPaths: readonly string[] | undefined,
): Names {
  const [names, setNames] = useState<Names>({
    paths: fallbackPaths ?? [],
    status: null,
    error: null,
  });
  useEffect(() => {
    if (!search) {
      setNames({ paths: fallbackPaths ?? [], status: null, error: null });
      return;
    }
    let disposed = false;
    let generation = 0;
    let knownTotal = -1;
    const load = () => {
      const mine = ++generation;
      search
        .listNames(handle)
        .then((listing) => {
          if (disposed || mine !== generation) {
            return;
          }
          knownTotal = listing.status.total;
          setNames({
            paths: listing.paths,
            status: listing.status,
            error: null,
          });
        })
        .catch((err) => {
          if (!disposed && mine === generation) {
            setNames((prev) => ({ ...prev, error: errorMessage(err) }));
          }
        });
    };
    load();
    let unsubscribe: (() => void) | undefined;
    search
      .subscribe((status) => {
        if (disposed || status.handle !== handle) {
          return;
        }
        setNames((prev) => (prev.error ? prev : { ...prev, status }));
        if (status.total !== knownTotal) {
          load();
        }
      })
      .then((off) => {
        if (disposed) {
          off();
        } else {
          unsubscribe = off;
        }
      })
      .catch(() => {});
    return () => {
      disposed = true;
      unsubscribe?.();
    };
    // fallbackPaths intentionally not a dependency when a backend exists.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, handle, search ? null : fallbackPaths]);
  return names;
}

/** Query that drills into the family of an item, or null when it has none. */
function drillQuery(item: PaletteItem): string | null {
  const drill =
    item.drill ??
    (item.title.includes(DRILL_SEPARATOR)
      ? item.title.slice(
          0,
          item.title.indexOf(DRILL_SEPARATOR) + DRILL_SEPARATOR.length,
        )
      : null);
  return drill ? `>${drill}` : null;
}

export const QuickSwitcher = ({
  search,
  handle,
  fallbackPaths,
  collectItems,
  platform,
  onOpenDrawing,
  onRunItem,
  onClose,
  ownerDocument,
}: QuickSwitcherProps) => {
  const win = ownerDocument?.defaultView ?? null;
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [items, setItems] = useState(() => collectItems());
  const [recent] = useState(() => getRecent(win));
  const listId = useId();
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const mounted = useRef(true);
  const pendingKey = useRef<string | null>(null);
  const previousFocus = useRef<Element | null>(
    ownerDocument?.activeElement ?? null,
  );
  const overrides = useHotkeyOverrides(win);
  const names = useDrawingNames(search, handle, fallbackPaths);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const drawings = useMemo(() => prepareDrawings(names.paths), [names.paths]);
  const prepared = useMemo(() => prepareItems(items), [items]);
  const rows = useMemo(
    () => rankRows(drawings, prepared, query, recent),
    [drawings, prepared, query, recent],
  );
  const selected = Math.min(active, Math.max(0, rows.length - 1));

  useEffect(() => {
    const el = listRef.current?.querySelector(`[aria-selected="true"]`);
    (el as HTMLElement | null)?.scrollIntoView?.({ block: "nearest" });
  }, [selected, rows]);

  // After a Mod+Enter re-collect, keep the active row if it still exists.
  useEffect(() => {
    const key = pendingKey.current;
    if (key !== null) {
      pendingKey.current = null;
      const at = rows.findIndex((r) => r.key === key);
      if (at >= 0) {
        setActive(at);
      }
    }
  }, [rows]);

  const dismiss = useCallback(() => {
    const prev = previousFocus.current as HTMLElement | null;
    if (prev && prev !== ownerDocument?.body && prev.isConnected) {
      prev.focus?.();
    } else {
      inputRef.current?.blur();
      focusCanvasIfIdle(ownerDocument);
    }
    onClose();
  }, [onClose, ownerDocument]);

  const pick = (index: number, keepOpen = false) => {
    const row = rows[index];
    if (!row) {
      return;
    }
    if (row.kind === "drawing") {
      recordRecent(row.key, win);
      onOpenDrawing(row.drawing.path);
      return;
    }
    const { item } = row.entry;
    recordRecent(row.key, win);
    onRunItem(item, keepOpen);
    if (keepOpen) {
      pendingKey.current = row.key;
      setTimeout(() => {
        if (!mounted.current) {
          return;
        }
        setItems(collectItems());
        if (ownerDocument?.activeElement !== inputRef.current) {
          onClose();
        }
      }, 0);
    }
  };

  const drill = () => {
    const row = rows[selected];
    const next = row?.kind === "item" ? drillQuery(row.entry.item) : null;
    if (next !== null) {
      setQuery(next);
      setActive(0);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.nativeEvent.isComposing) {
      return;
    }
    const swallow = () => {
      e.preventDefault();
      e.stopPropagation();
    };
    const el = inputRef.current;
    const atEnd =
      !!el &&
      el.selectionStart === el.value.length &&
      el.selectionEnd === el.value.length;
    const step = (to: number) => {
      swallow();
      if (rows.length > 0) {
        setActive(to);
      }
    };
    if (e.key === "Escape") {
      swallow();
      dismiss();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      step(
        (selected + (e.key === "ArrowDown" ? 1 : -1) + rows.length) %
          rows.length,
      );
    } else if (e.key === "PageDown" || e.key === "PageUp") {
      const to = selected + (e.key === "PageDown" ? 8 : -8);
      step(Math.max(0, Math.min(rows.length - 1, to)));
    } else if (e.key === "Enter") {
      swallow();
      pick(selected, platform === "mac" ? e.metaKey : e.ctrlKey);
    } else if (e.key === "Tab") {
      swallow();
      if (!e.shiftKey) {
        drill();
      }
    } else if (
      e.key === "ArrowRight" &&
      atEnd &&
      !e.metaKey &&
      !e.ctrlKey &&
      !e.altKey &&
      !e.shiftKey
    ) {
      swallow();
      drill();
    } else {
      const self = getCommand(SWITCHER_ID);
      const chord = chordFromEvent(e.nativeEvent, platform);
      if (
        self &&
        chord &&
        effectiveKeys(self, overrides, platform).includes(chord)
      ) {
        swallow();
        dismiss();
      }
    }
  };

  const indexing =
    names.status && names.status.state !== "ready"
      ? `Indexing… ${names.status.indexed}/${names.status.total}`
      : null;
  const optionId = (i: number) => `${listId}-opt-${i}`;

  return (
    <div
      className="vault-modal-backdrop vault-quick-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) {
          dismiss();
        }
      }}
      onKeyDown={onKeyDown}
    >
      <div
        className="vault-modal vault-quick"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
      >
        <input
          ref={inputRef}
          className="vault-quick__input"
          type="text"
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={rows.length ? optionId(selected) : undefined}
          aria-label="Search drawings and commands"
          placeholder="Search drawings and commands  (> commands only)"
          // eslint-disable-next-line jsx-a11y/no-autofocus
          autoFocus
          spellCheck={false}
          autoComplete="off"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
        />
        <div
          id={listId}
          ref={listRef}
          className="vault-quick__list"
          role="listbox"
          aria-label="Results"
        >
          {rows.map((row, i) => (
            <RowView
              key={row.key}
              id={optionId(i)}
              row={row}
              index={i}
              active={i === selected}
              onHover={setActive}
              onPick={pick}
            />
          ))}
        </div>
        {rows.length === 0 && (
          <div className="vault-quick__empty">No matches</div>
        )}
        {names.error && (
          <div className="vault-quick__empty" role="status">
            Could not list drawings: {names.error}
          </div>
        )}
        {indexing && (
          <div className="vault-quick__empty" role="status">
            {indexing}
          </div>
        )}
      </div>
    </div>
  );
};

export default QuickSwitcher;
