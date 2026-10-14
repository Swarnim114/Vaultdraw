/**
 * Cmd+P quick switcher: one keyboard-first list of drawings (fuzzy-ranked by
 * path) and commands. A leading ">" restricts it to commands. The name list
 * is fetched once per open (and again when the index reports new totals);
 * everything is prepared once and ranked synchronously per keystroke.
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

import { getCommand } from "../commands/commands";
import { filter, prepare } from "../commands/fuzzy";
import { chordFromEvent, formatChord } from "../commands/keys";
import { effectiveKeys } from "../commands/keymap";
import { useHotkeyOverrides } from "../commands/useCommands";
import { errorMessage } from "../vault/types";

import { IconDrawing } from "./Icons";

import "./QuickSwitcher.css";

import type { Prepared, Ranked } from "../commands/fuzzy";
import type {
  CommandDefinition,
  HotkeyOverrides,
  Platform,
} from "../commands/types";
import type { IndexStatus, VaultSearch } from "../search/types";

const MAX_DRAWINGS = 50;
const MAX_COMMANDS = 10;
const SWITCHER_ID = "palette.quickSwitcher";
const EXTENSION = /\.excalidraw$/i;

export interface QuickSwitcherProps {
  /** Source of the drawing names; null = use `fallbackPaths`. */
  search: Pick<VaultSearch, "listNames" | "subscribe"> | null;
  handle: string;
  /** Used when there is no search backend. */
  fallbackPaths?: readonly string[];
  /** Commands runnable right now (decided by the caller before opening). */
  commandIds: readonly string[];
  platform: Platform;
  onOpenDrawing(path: string): void;
  onRunCommand(id: string): void;
  onClose(): void;
  ownerDocument?: Document | null;
}

interface DrawingItem {
  path: string;
  prepared: Prepared;
}
interface CommandItem {
  command: CommandDefinition;
  prepared: Prepared;
}
type Row =
  | { kind: "drawing"; hit: Ranked<DrawingItem> }
  | { kind: "command"; hit: Ranked<CommandItem> };

const drawingPrepared = (item: DrawingItem) => item.prepared;
const commandPrepared = (item: CommandItem) => item.prepared;

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
  row: Row;
  active: boolean;
  index: number;
  shortcut: string;
  onHover(index: number): void;
  onPick(index: number): void;
}

const RowView = memo(
  ({ id, row, active, index, shortcut, onHover, onPick }: RowViewProps) => {
    const positions = new Set(row.hit.positions);
    let body: React.ReactNode;
    if (row.kind === "drawing") {
      const { path } = row.hit.item;
      const slash = path.lastIndexOf("/");
      const nameEnd = path.replace(EXTENSION, "").length;
      body = (
        <>
          <IconDrawing />
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
      const { command, prepared } = row.hit.item;
      body = (
        <>
          <span className="vault-quick__name">
            {highlight(prepared.text, 0, prepared.text.length, positions)}
          </span>
          <span className="vault-quick__muted">{command.category}</span>
          {shortcut && <kbd className="vault-quick__keys">{shortcut}</kbd>}
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

const shortcutFor = (
  command: CommandDefinition,
  overrides: HotkeyOverrides,
  platform: Platform,
) => {
  const first = effectiveKeys(command, overrides, platform)[0];
  return first ? formatChord(first, platform) : "";
};

export const QuickSwitcher = ({
  search,
  handle,
  fallbackPaths,
  commandIds,
  platform,
  onOpenDrawing,
  onRunCommand,
  onClose,
  ownerDocument,
}: QuickSwitcherProps) => {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listId = useId();
  const listRef = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<Element | null>(
    ownerDocument?.activeElement ?? null,
  );
  const overrides = useHotkeyOverrides(ownerDocument?.defaultView ?? null);
  const names = useDrawingNames(search, handle, fallbackPaths);

  const drawings = useMemo<DrawingItem[]>(
    () => names.paths.map((path) => ({ path, prepared: prepare(path) })),
    [names.paths],
  );
  const commands = useMemo<CommandItem[]>(() => {
    const out: CommandItem[] = [];
    for (const id of commandIds) {
      const command = getCommand(id);
      if (command && command.palette !== false && id !== SWITCHER_ID) {
        out.push({ command, prepared: prepare(command.title) });
      }
    }
    return out;
  }, [commandIds]);

  const rows = useMemo<Row[]>(() => {
    const commandsOnly = query.startsWith(">");
    const text = commandsOnly ? query.slice(1) : query;
    const hasQuery = text.trim() !== "";
    const out: Row[] = [];
    if (!commandsOnly) {
      for (const hit of filter(drawings, text, drawingPrepared, MAX_DRAWINGS)) {
        out.push({ kind: "drawing", hit });
      }
    }
    const commandLimit = hasQuery ? MAX_COMMANDS : commands.length;
    for (const hit of filter(commands, text, commandPrepared, commandLimit)) {
      out.push({ kind: "command", hit });
    }
    return out;
  }, [query, drawings, commands]);

  const drawingCount = rows.filter((r) => r.kind === "drawing").length;
  const selected = Math.min(active, Math.max(0, rows.length - 1));

  useEffect(() => {
    const el = listRef.current?.querySelector(`[aria-selected="true"]`);
    (el as HTMLElement | null)?.scrollIntoView?.({ block: "nearest" });
  }, [selected, rows]);

  const dismiss = useCallback(() => {
    const prev = previousFocus.current as HTMLElement | null;
    if (prev && prev !== ownerDocument?.body) {
      prev.focus?.();
    }
    onClose();
  }, [onClose, ownerDocument]);

  const pick = (index: number) => {
    const row = rows[index];
    if (!row) {
      return;
    }
    if (row.kind === "drawing") {
      onOpenDrawing(row.hit.item.path);
    } else {
      onRunCommand(row.hit.item.command.id);
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
    if (e.key === "Escape") {
      swallow();
      dismiss();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      swallow();
      if (rows.length > 0) {
        const step = e.key === "ArrowDown" ? 1 : -1;
        setActive((selected + step + rows.length) % rows.length);
      }
    } else if (e.key === "Enter") {
      swallow();
      pick(selected);
    } else if (e.key === "Tab") {
      swallow();
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
  const commandStart = drawingCount;
  const optionId = (i: number) => `${listId}-opt-${i}`;
  const renderRow = (row: Row, i: number) => (
    <RowView
      key={`${row.kind}:${
        row.kind === "drawing" ? row.hit.item.path : row.hit.item.command.id
      }`}
      id={optionId(i)}
      row={row}
      index={i}
      active={i === selected}
      shortcut={
        row.kind === "command"
          ? shortcutFor(row.hit.item.command, overrides, platform)
          : ""
      }
      onHover={setActive}
      onPick={pick}
    />
  );

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
        aria-label="Quick switcher"
      >
        <input
          className="vault-quick__input"
          type="text"
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={rows.length ? optionId(selected) : undefined}
          aria-label="Search drawings and commands"
          placeholder="Search drawings, or type > for commands"
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
          {drawingCount > 0 && (
            <div role="group" aria-label="Drawings">
              <div className="vault-quick__group" aria-hidden="true">
                Drawings
              </div>
              {rows.slice(0, drawingCount).map((row, i) => renderRow(row, i))}
            </div>
          )}
          {rows.length > drawingCount && (
            <div role="group" aria-label="Commands">
              <div className="vault-quick__group" aria-hidden="true">
                Commands
              </div>
              {rows
                .slice(drawingCount)
                .map((row, i) => renderRow(row, commandStart + i))}
            </div>
          )}
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
