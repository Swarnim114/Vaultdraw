import { useEffect, useMemo, useRef, useState } from "react";

import { COMMANDS } from "../../../commands/commands";
import { pauseDispatcher } from "../../../commands/dispatcher";
import {
  conflictCount,
  findConflicts,
  type Conflict,
} from "../../../commands/conflicts";
import {
  chordFromEvent,
  detectPlatform,
  formatChord,
} from "../../../commands/keys";
import {
  effectiveKeys,
  isCustomised,
  overrideFor,
} from "../../../commands/keymap";
import { reservedReason } from "../../../commands/reserved";
import {
  setHotkeyOverride,
  useHotkeyOverrides,
} from "../../../commands/useCommands";
import { openConfigDir } from "../../../vault/settingsSync";
import { getSettingSchema } from "../schema";
import { useSettings, type SettingControls } from "../SettingsContext";

import "./Hotkeys.css";

import type { Chord, CommandDefinition } from "../../../commands/types";

type FilterId = "all" | "assigned" | "customised" | "unassigned" | "conflicts";

/** What the next key press is captured for: a command row, or the filter box. */
type Recording = { kind: "command"; id: string } | { kind: "filter" } | null;

const SORTED: readonly CommandDefinition[] = [...COMMANDS].sort(
  (a, b) =>
    a.category.localeCompare(b.category) || a.title.localeCompare(b.title),
);

const describeConflict = (c: Conflict): string => {
  switch (c.kind) {
    case "command":
      return `Also bound to: ${c.title}`;
    case "excalidraw":
      return `Excalidraw: ${c.label}`;
    default:
      return c.reason.charAt(0).toUpperCase() + c.reason.slice(1);
  }
};

const errorText = (err: unknown) =>
  err instanceof Error ? err.message : String(err);

const HotkeysPage = () => {
  const { win: ctxWin, settingsStatus } = useSettings();
  const win = ctxWin ?? (typeof window !== "undefined" ? window : null);
  const platform = useMemo(() => detectPlatform(win), [win]);
  const overrides = useHotkeyOverrides(win);

  const [text, setText] = useState("");
  const [chordFilter, setChordFilter] = useState<Chord | null>(null);
  const [chip, setChip] = useState<FilterId>("all");
  const [recording, setRecording] = useState<Recording>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);

  const conflicts = useMemo(
    () => findConflicts(COMMANDS, overrides, platform),
    [overrides, platform],
  );
  const conflictTotal = conflictCount(conflicts);

  const live = useRef({ overrides, platform });
  live.current = { overrides, platform };

  // Capture keys for the active recording. The dispatcher is paused and the
  // window capture listener swallows every key, so neither the app, Excalidraw
  // nor Settings' own Escape handler sees them.
  useEffect(() => {
    if (!recording || !win) {
      return;
    }
    const release = pauseDispatcher();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.isComposing || e.keyCode === 229) {
        return;
      }
      e.preventDefault();
      e.stopImmediatePropagation();
      const { overrides: current, platform: plat } = live.current;
      const chord = chordFromEvent(e, plat);
      if (e.key === "Escape" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        setRecording(null);
        setRefusal(null);
        return;
      }
      if (!chord) {
        return; // modifier-only: keep waiting
      }
      if (recording.kind === "filter") {
        setChordFilter(chord);
        setRecording(null);
        return;
      }
      const command = COMMANDS.find((c) => c.id === recording.id);
      if (!command) {
        return;
      }
      const write = (keys: Chord[]) =>
        setHotkeyOverride(command.id, overrideFor(command, keys, plat), win);
      if (chord === "Backspace" || chord === "Delete") {
        write([]);
      } else {
        const reason = reservedReason(chord, plat);
        if (reason) {
          setRefusal(`Can't use ${formatChord(chord, plat)}: ${reason}`);
          return;
        }
        write([...effectiveKeys(command, current, plat), chord]);
      }
      setRefusal(null);
      setRecording(null);
    };
    win.addEventListener("keydown", onKeyDown, true);
    return () => {
      win.removeEventListener("keydown", onKeyDown, true);
      release();
    };
  }, [recording, win]);

  const startRecording = (next: NonNullable<Recording>) => {
    setRefusal(null);
    setRecording(next);
  };

  const rows = useMemo(() => {
    const needle = text.trim().toLocaleLowerCase();
    return SORTED.filter((command) => {
      const keys = effectiveKeys(command, overrides, platform);
      if (chordFilter && !keys.includes(chordFilter)) {
        return false;
      }
      if (
        needle &&
        !`${command.title}\n${command.id}\n${command.category}`
          .toLocaleLowerCase()
          .includes(needle)
      ) {
        return false;
      }
      switch (chip) {
        case "assigned":
          return keys.length > 0;
        case "unassigned":
          return keys.length === 0;
        case "customised":
          return isCustomised(command, overrides, platform);
        case "conflicts":
          return conflicts.has(command.id);
        default:
          return true;
      }
    });
  }, [text, chordFilter, chip, overrides, platform, conflicts]);

  const chips: { id: FilterId; label: string }[] = [
    { id: "all", label: "All" },
    { id: "assigned", label: "Assigned" },
    { id: "customised", label: "Customised" },
    { id: "unassigned", label: "Unassigned" },
  ];
  if (conflictTotal > 0 || chip === "conflicts") {
    chips.push({ id: "conflicts", label: "Conflicts" });
  }

  const capturing = recording?.kind === "filter";

  const handleOpenConfig = async () => {
    setOpenError(null);
    try {
      await openConfigDir();
    } catch (err) {
      setOpenError(`Could not open the config folder: ${errorText(err)}`);
    }
  };

  return (
    <div className="vault-hotkeys" data-setting-id="hotkeys-list">
      {conflictTotal > 0 && (
        <div className="vault-hotkeys__notice" role="status">
          {conflictTotal} {conflictTotal === 1 ? "conflict" : "conflicts"}
        </div>
      )}

      <div className="vault-hotkeys__toolbar">
        <div className="vault-hotkeys__filter">
          {chordFilter ? (
            <span className="vault-hotkeys__chip-key">
              <kbd>{formatChord(chordFilter, platform)}</kbd>
              <button
                type="button"
                className="vault-hotkeys__icon-btn"
                aria-label="Clear key filter"
                onClick={() => setChordFilter(null)}
              >
                ×
              </button>
            </span>
          ) : capturing ? (
            <span className="vault-hotkeys__pending">Press a key…</span>
          ) : (
            <input
              type="search"
              className="vault-hotkeys__input"
              placeholder="Filter commands"
              aria-label="Filter hotkeys"
              value={text}
              onChange={(e) => setText(e.target.value)}
              spellCheck={false}
              autoComplete="off"
            />
          )}
        </div>
        <button
          type="button"
          className={`vault-btn vault-btn--sm vault-hotkeys__record ${
            capturing ? "vault-hotkeys__record--on" : ""
          }`}
          aria-pressed={capturing}
          aria-label="Record keys"
          title="Record keys: show every command bound to the next key you press"
          onClick={() =>
            capturing ? setRecording(null) : startRecording({ kind: "filter" })
          }
        >
          ⌨
        </button>
      </div>

      <div className="vault-hotkeys__chips" role="group" aria-label="Show">
        {chips.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            className={`vault-hotkeys__filter-chip ${
              chip === id ? "vault-hotkeys__filter-chip--active" : ""
            }`}
            aria-pressed={chip === id}
            onClick={() => setChip(id)}
          >
            {label}
            {id === "conflicts" && (
              <span className="vault-hotkeys__badge">{conflictTotal}</span>
            )}
          </button>
        ))}
      </div>

      <ul className="vault-hotkeys__list" aria-label="Hotkeys">
        {rows.length === 0 && (
          <li className="vault-settings-empty" role="status">
            No commands match.
          </li>
        )}
        {rows.map((command) => {
          const keys = effectiveKeys(command, overrides, platform);
          const perChord = conflicts.get(command.id);
          const recordingHere =
            recording?.kind === "command" && recording.id === command.id;
          return (
            <li
              key={command.id}
              className="vault-hotkeys__row"
              data-command-id={command.id}
            >
              <div className="vault-hotkeys__name">
                <span className="vault-hotkeys__title">{command.title}</span>
                <span className="vault-hotkeys__category">
                  {command.category}
                </span>
              </div>
              <div className="vault-hotkeys__keys">
                {keys.map((chord) => {
                  const found = perChord?.get(chord);
                  const label = formatChord(chord, platform);
                  return (
                    <span
                      key={chord}
                      className={`vault-hotkeys__chip-key ${
                        found ? "vault-hotkeys__chip-key--conflict" : ""
                      }`}
                      title={found?.map(describeConflict).join("\n")}
                      data-conflict={found ? "true" : undefined}
                    >
                      <kbd>{label}</kbd>
                      <button
                        type="button"
                        className="vault-hotkeys__icon-btn"
                        aria-label={`Remove ${label} from ${command.title}`}
                        onClick={() =>
                          setHotkeyOverride(
                            command.id,
                            overrideFor(
                              command,
                              keys.filter((k) => k !== chord),
                              platform,
                            ),
                            win,
                          )
                        }
                      >
                        ×
                      </button>
                    </span>
                  );
                })}
                {recordingHere && (
                  <button
                    type="button"
                    className="vault-hotkeys__pending"
                    aria-label="Cancel recording"
                    onClick={() => setRecording(null)}
                  >
                    Press a key…
                  </button>
                )}
                {isCustomised(command, overrides, platform) && (
                  <button
                    type="button"
                    className="vault-hotkeys__icon-btn"
                    aria-label={`Reset ${command.title} to default`}
                    title="Reset to default"
                    onClick={() => setHotkeyOverride(command.id, null, win)}
                  >
                    ↺
                  </button>
                )}
                <button
                  type="button"
                  className="vault-hotkeys__icon-btn vault-hotkeys__add"
                  aria-label={`Add hotkey for ${command.title}`}
                  title="Add hotkey"
                  onClick={() =>
                    recordingHere
                      ? setRecording(null)
                      : startRecording({ kind: "command", id: command.id })
                  }
                >
                  +
                </button>
              </div>
              {recordingHere && refusal && (
                <div className="vault-hotkeys__refusal" role="alert">
                  {refusal}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {settingsStatus.mode === "tauri" && (
        <div className="vault-hotkeys__footer">
          <button
            type="button"
            className="vault-hotkeys__link"
            onClick={() => void handleOpenConfig()}
          >
            Open hotkeys in config.toml
          </button>
          {openError && (
            <span className="vault-config-status--error" role="status">
              {openError}
            </span>
          )}
        </div>
      )}
    </div>
  );
};

/** Search results only point at the page; the full list lives on its page. */
const HotkeysSearchHint = () => (
  <p className="vault-settings-empty">
    {getSettingSchema("hotkeys-list").description}
  </p>
);

export const hotkeysControls: SettingControls = {
  "hotkeys-list": {
    Component: HotkeysPage,
    SearchComponent: HotkeysSearchHint,
  },
};
