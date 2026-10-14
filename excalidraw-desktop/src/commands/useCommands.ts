/** React glue: live hotkey overrides, the window dispatcher and run(id). */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  getPreferences,
  subscribePreferences,
  updatePreferences,
} from "../vault/preferences";

import { COMMANDS, getCommand } from "./commands";
import { readContext, whenHolds, type AppContext } from "./context";
import { installCommandDispatcher, runHandler } from "./dispatcher";
import { detectPlatform } from "./keys";
import { buildKeymap } from "./keymap";

import type {
  Chord,
  CommandContext,
  CommandHandlers,
  HotkeyOverrides,
  Platform,
} from "./types";

/** `[hotkeys]` overrides, kept in sync with the preferences store. */
export function useHotkeyOverrides(win: Window | null): HotkeyOverrides {
  const [overrides, setOverrides] = useState<HotkeyOverrides>(
    () => getPreferences(win).hotkeys,
  );
  const lastJson = useRef(JSON.stringify(overrides));
  useEffect(() => {
    const sync = () => {
      const next = getPreferences(win).hotkeys;
      const json = JSON.stringify(next);
      if (json !== lastJson.current) {
        lastJson.current = json;
        setOverrides(next);
      }
    };
    sync();
    return subscribePreferences(sync);
  }, [win]);
  return overrides;
}

/** Set the override for `id`; null removes it (back to the defaults). */
export function setHotkeyOverride(
  id: string,
  keys: readonly Chord[] | null,
  win?: Window | null,
): void {
  const next = { ...getPreferences(win).hotkeys };
  if (keys === null) {
    delete next[id];
  } else {
    next[id] = [...keys];
  }
  updatePreferences({ hotkeys: next }, win);
}

export interface CommandRunner {
  /** Run a command if it is available; true when a handler ran. */
  run(id: string): boolean;
  isAvailable(id: string): boolean;
  platform: Platform;
}

interface Options {
  handlers: CommandHandlers;
  app: AppContext;
}

/** `when` rules that depend on where the key was pressed do not apply to run(). */
const FOCUS_RULES = new Set(["textEditing", "canvasFocus"]);

export function useCommandDispatcher(
  doc: Document | null,
  win: Window | null,
  { handlers, app }: Options,
): CommandRunner {
  const platform = useMemo(() => detectPlatform(win), [win]);
  const overrides = useHotkeyOverrides(win);
  const keymap = useMemo(
    () => buildKeymap(COMMANDS, overrides, platform),
    [overrides, platform],
  );

  const live = useRef({ handlers, app, keymap });
  live.current = { handlers, app, keymap };

  const context = useCallback(
    (): CommandContext =>
      doc
        ? readContext(doc, live.current.app)
        : {
            ...live.current.app,
            textEditing: false,
            canvasFocus: false,
            modalOpen: false,
          },
    [doc],
  );

  useEffect(() => {
    if (!win) {
      return;
    }
    return installCommandDispatcher(win, {
      platform,
      getKeymap: () => live.current.keymap,
      getContext: context,
      getHandler: (id) => live.current.handlers[id],
    });
  }, [win, platform, context]);

  const isAvailable = useCallback(
    (id: string) => {
      const command = getCommand(id);
      if (!command || !live.current.handlers[id]) {
        return false;
      }
      const when = command.when?.filter(
        (clause) => !FOCUS_RULES.has(clause.replace("!", "")),
      );
      return whenHolds(when, context());
    },
    [context],
  );

  const run = useCallback(
    (id: string) => {
      const handler = live.current.handlers[id];
      if (!handler || !isAvailable(id)) {
        return false;
      }
      runHandler(id, handler);
      return true;
    },
    [isAvailable],
  );

  return { run, isAvailable, platform };
}
