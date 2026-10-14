/**
 * GUI <-> config.toml round trip for [hotkeys]: the Hotkeys page writes
 * through settingsSync's update_config, a hand edit of the file reloads live
 * into the page and the dispatcher. The fake backend keeps config.toml as
 * text and edits it like Rust `config::apply_changes` (first dot splits table
 * and key, dotted keys are quoted, values replaced in place keeping trailing
 * comments, null deletes the line, a bad key applies nothing).
 */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { detectPlatform } from "../commands/keys";
import { useCommandDispatcher } from "../commands/useCommands";
import { SettingsModal } from "../components/settings/SettingsModal";
import { getPreferences } from "../vault/preferences";
import {
  disposeSettings,
  flushSettings,
  initSettings,
  type ConfigChange,
  type LoadSettingsResult,
} from "../vault/settingsSync";

import type { VaultInfo } from "../vault/types";

// ---------------------------------------------------------------------------
// Fake config backend (TOML subset: [tables], comments, key = JSON-ish value)
// ---------------------------------------------------------------------------

const TABLE = /^\s*\[([A-Za-z0-9_-]+)\]\s*$/;
const ENTRY = /^\s*("(?:[^"\\]|\\.)*"|[A-Za-z0-9_-]+)\s*=\s*(.*)$/;
const VALID = (s: string, dots: boolean) =>
  s.length > 0 &&
  s.length <= 64 &&
  (dots ? /^[A-Za-z0-9_.-]+$/ : /^[A-Za-z0-9_-]+$/).test(s) &&
  !s.startsWith(".") &&
  !s.endsWith(".") &&
  !s.includes("..");

/** Value and trailing comment of `raw` (strings never contain '#' here). */
const splitComment = (raw: string) => {
  const hash = raw.indexOf("#");
  return hash < 0
    ? { value: raw.trim(), comment: "" }
    : { value: raw.slice(0, hash).trim(), comment: ` ${raw.slice(hash)}` };
};

const unquote = (key: string) => (key.startsWith('"') ? JSON.parse(key) : key);
const quote = (key: string) =>
  /^[A-Za-z0-9_-]+$/.test(key) ? key : `"${key}"`;
const tomlValue = (v: unknown) =>
  Array.isArray(v)
    ? `[${v.map((x) => JSON.stringify(x)).join(", ")}]`
    : JSON.stringify(v);

function parseToml(text: string): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {};
  let table: Record<string, unknown> | null = null;
  for (const line of text.split("\n")) {
    const t = TABLE.exec(line);
    if (t) {
      table = out[t[1]] ??= {};
      continue;
    }
    const e = ENTRY.exec(line);
    if (e && !line.trimStart().startsWith("#")) {
      if (!table) {
        throw new Error("root keys are not used by this fake");
      }
      table[unquote(e[1])] = JSON.parse(splitComment(e[2]).value);
    }
  }
  return out;
}

function applyChanges(text: string, changes: ConfigChange[]): string {
  const planned = changes.map(({ key, value }) => {
    const dot = key.indexOf(".");
    const table = key.slice(0, dot);
    const name = key.slice(dot + 1);
    if (dot < 0 || !VALID(table, false) || !VALID(name, true)) {
      throw new Error(`Invalid config key "${key}"; expected "table.key"`);
    }
    return { table, name, value };
  });
  const lines = text.split("\n");
  for (const { table, name, value } of planned) {
    let start = lines.findIndex((l) => TABLE.exec(l)?.[1] === table);
    if (start < 0) {
      if (value === null) {
        continue;
      }
      if (lines[lines.length - 1] === "") {
        lines.pop();
      }
      lines.push("", `[${table}]`, "");
      start = lines.length - 2;
    }
    let end = lines.findIndex((l, i) => i > start && TABLE.test(l));
    end = end < 0 ? lines.length : end;
    const at = lines.findIndex((l, i) => {
      const e = i > start && i < end && !l.trimStart().startsWith("#");
      return e && unquote(ENTRY.exec(l)?.[1] ?? "\u0000") === name;
    });
    if (value === null) {
      if (at >= 0) {
        lines.splice(at, 1);
      }
    } else if (at >= 0) {
      const { comment } = splitComment(ENTRY.exec(lines[at])![2]);
      lines[at] = `${quote(name)} = ${tomlValue(value)}${comment}`;
    } else {
      let last = end - 1;
      while (last > start && lines[last].trim() === "") {
        last--;
      }
      lines.splice(last + 1, 0, `${quote(name)} = ${tomlValue(value)}`);
    }
  }
  return lines.join("\n");
}

const INITIAL = `# Vaultdraw config
[saving]
autosave_delay_ms = 500

[hotkeys]
# Override a command's keys; [] removes them.
"file.save" = ["Mod+S"] # mine
`;

const createBackend = () => {
  const backend = {
    toml: INITIAL,
    writes: [] as ConfigChange[][],
    onConfigChange: null as null | (() => void),
    invoke: vi.fn(async (cmd: string, args?: Record<string, unknown>) => {
      switch (cmd) {
        case "load_settings":
          return {
            configDir: "/c",
            configPath: "/c/config.toml",
            statePath: "/s/state.json",
            config: parseToml(backend.toml),
            configError: null,
            state: { recentVaults: [] },
          } as LoadSettingsResult;
        case "update_config": {
          const { changes } = args as { changes: ConfigChange[] };
          backend.writes.push(changes);
          backend.toml = applyChanges(backend.toml, changes);
          // The watcher echoes our own write, like the real app.
          queueMicrotask(() => backend.onConfigChange?.());
          return undefined;
        }
        case "write_state":
          return undefined;
        default:
          throw new Error(`unknown command ${cmd}`);
      }
    }),
    listen: vi.fn(async (_event: string, handler: () => void) => {
      backend.onConfigChange = handler;
      return () => {
        backend.onConfigChange = null;
      };
    }),
    /** Simulates saving config.toml in an editor. */
    async handEdit(next: string) {
      backend.toml = next;
      await act(async () => {
        backend.onConfigChange?.();
        await flushSettings();
      });
    },
  };
  return backend;
};

// ---------------------------------------------------------------------------

const vault: VaultInfo = {
  handle: "hotkeys-roundtrip",
  name: "Vault",
  path: "/Users/test/Vault",
  readOnly: false,
};
const mac = detectPlatform(window) === "mac";
const MOD = mac ? { metaKey: true } : { ctrlKey: true };
const MOD_LABEL = mac ? "⌘" : "Ctrl+";

const settle = () =>
  act(async () => {
    await flushSettings();
    await new Promise((r) => setTimeout(r, 0));
    await flushSettings();
  });

const hotkeysLines = (toml: string) =>
  toml.slice(toml.indexOf("[hotkeys]")).trim().split("\n");

/**
 * The live dispatcher as in VaultApp, plus Settings on the Hotkeys page when
 * `settings` (New drawing is `!modalOpen`, so keys are tested without it).
 */
const Harness = ({
  newDrawing,
  settings = true,
}: {
  newDrawing: () => void;
  settings?: boolean;
}) => {
  useCommandDispatcher(document, window, {
    handlers: { "vault.newDrawing": newDrawing },
    app: { vaultOpen: true, drawingOpen: false, writable: true },
  });
  return !settings ? null : (
    <SettingsModal
      vault={vault}
      onClose={() => {}}
      ownerDocument={document}
      initialPage="hotkeys"
    />
  );
};

const pressOnBody = (init: KeyboardEventInit) =>
  act(() => {
    document.body.dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        ...init,
      }),
    );
  });

describe("[hotkeys] GUI <-> config.toml round trip", () => {
  let backend: ReturnType<typeof createBackend>;

  beforeEach(async () => {
    window.localStorage.clear();
    backend = createBackend();
    await initSettings(window, {
      tauri: true,
      invoke: backend.invoke as never,
      listen: backend.listen as never,
    });
  });
  afterEach(() => {
    cleanup();
    disposeSettings();
    window.localStorage.clear();
  });

  it("GUI edits write minimal per-id lines, keeping comments and other tables", async () => {
    render(<Harness newDrawing={vi.fn()} />);
    // file.save equals its default: not an override.
    expect(getPreferences(window).hotkeys).toEqual({ "file.save": ["Mod+S"] });

    fireEvent.click(
      screen.getByRole("button", { name: "Add hotkey for New drawing" }),
    );
    fireEvent.keyDown(window, { code: "KeyJ", key: "j", altKey: true, ...MOD });
    await settle();
    expect(backend.writes.at(-1)).toEqual([
      { key: "hotkeys.vault.newDrawing", value: ["Mod+N", "Mod+Alt+J"] },
    ]);
    expect(hotkeysLines(backend.toml)).toEqual([
      "[hotkeys]",
      "# Override a command's keys; [] removes them.",
      '"file.save" = ["Mod+S"] # mine',
      '"vault.newDrawing" = ["Mod+N", "Mod+Alt+J"]',
    ]);
    expect(backend.toml).toContain("[saving]\nautosave_delay_ms = 500\n");

    // Removing the default chord keeps only the custom one.
    fireEvent.click(
      screen.getByRole("button", {
        name: `Remove ${MOD_LABEL}N from New drawing`,
      }),
    );
    await settle();
    expect(hotkeysLines(backend.toml)).toContain(
      '"vault.newDrawing" = ["Mod+Alt+J"]',
    );

    // Reset deletes the line; the comment and other entries stay.
    fireEvent.click(
      screen.getByRole("button", { name: "Reset New drawing to default" }),
    );
    await settle();
    expect(hotkeysLines(backend.toml)).toEqual([
      "[hotkeys]",
      "# Override a command's keys; [] removes them.",
      '"file.save" = ["Mod+S"] # mine',
    ]);
    // The watcher echo of our own writes changed nothing.
    expect(getPreferences(window).hotkeys).toEqual({ "file.save": ["Mod+S"] });
  });

  it("a hand edit applies live to the page and the dispatcher, and the GUI keeps it", async () => {
    const newDrawing = vi.fn();
    const { rerender } = render(<Harness newDrawing={newDrawing} />);
    const showSettings = (settings: boolean) =>
      rerender(<Harness newDrawing={newDrawing} settings={settings} />);

    await backend.handEdit(
      `${backend.toml}"vault.newDrawing" = ["cmd+alt+k"] # hand edit\n"future.cmd" = ["Mod+J"]\n`,
    );
    // "cmd" is the literal Command/Meta key in canonical form.
    const expected = "Alt+Meta+K";
    expect(getPreferences(window).hotkeys["vault.newDrawing"]).toEqual([
      expected,
    ]);
    // The page shows the new chord in place of the default.
    expect(
      screen.getByRole("button", {
        name: /^Remove .*K from New drawing$/,
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", {
        name: `Remove ${MOD_LABEL}N from New drawing`,
      }),
    ).toBeNull();

    // The dispatcher uses it: Cmd+Alt+K (literal Meta) runs, Mod+N does not.
    showSettings(false);
    pressOnBody({ code: "KeyK", key: "k", altKey: true, metaKey: true });
    expect(newDrawing).toHaveBeenCalledTimes(1);
    pressOnBody({ code: "KeyN", key: "n", ...MOD });
    expect(newDrawing).toHaveBeenCalledTimes(1);

    // A GUI edit afterwards rewrites only that line, keeping the comment and
    // the unknown id written by a newer version.
    showSettings(true);
    fireEvent.click(
      screen.getByRole("button", { name: "Add hotkey for New drawing" }),
    );
    fireEvent.keyDown(window, { code: "KeyL", key: "l", altKey: true, ...MOD });
    await settle();
    expect(hotkeysLines(backend.toml)).toEqual([
      "[hotkeys]",
      "# Override a command's keys; [] removes them.",
      '"file.save" = ["Mod+S"] # mine',
      // Saving from the GUI normalises chords: on macOS Cmd is Mod.
      `"vault.newDrawing" = ["${
        mac ? "Mod+Alt+K" : expected
      }", "Mod+Alt+L"] # hand edit`,
      '"future.cmd" = ["Mod+J"]',
    ]);
    expect(
      screen.getByRole("button", { name: /^Remove .*L from New drawing$/ }),
    ).toBeInTheDocument();

    // Deleting the line by hand restores the default live.
    showSettings(false);
    await backend.handEdit(
      backend.toml.replace(/^"vault\.newDrawing".*\n/m, ""),
    );
    expect(getPreferences(window).hotkeys["vault.newDrawing"]).toBeUndefined();
    pressOnBody({ code: "KeyN", key: "n", ...MOD });
    expect(newDrawing).toHaveBeenCalledTimes(2);
  });

  it("an invalid hand-edited chord is dropped for that entry only", async () => {
    render(<Harness newDrawing={vi.fn()} />);
    await backend.handEdit(
      `${backend.toml}"vault.newDrawing" = ["Mod+Nope", "Mod+Shift+N"]\n`,
    );
    expect(getPreferences(window).hotkeys["vault.newDrawing"]).toEqual([
      "Mod+Shift+N",
    ]);
    // The file is not rewritten by the reload.
    expect(backend.writes).toEqual([]);
  });
});

describe("fake apply_changes matches the Rust contract", () => {
  it("is the Rust test case dotted_hotkey_keys_round_trip_quoted_with_comments_preserved", () => {
    const src =
      '# top\n[hotkeys]\n# mine\n"file.save" = ["Mod+S"] # keep\n\n[saving]\nautosave_delay_ms = 500\n';
    const out = applyChanges(src, [
      { key: "hotkeys.vault.newDrawing", value: ["Mod+N", "Mod+Alt+N"] },
      { key: "hotkeys.view.toggleNavigator", value: [] },
      { key: "hotkeys.file.save", value: ["Mod+Shift+S"] },
    ]);
    expect(out).toBe(
      '# top\n[hotkeys]\n# mine\n"file.save" = ["Mod+Shift+S"] # keep\n"vault.newDrawing" = ["Mod+N", "Mod+Alt+N"]\n"view.toggleNavigator" = []\n\n[saving]\nautosave_delay_ms = 500\n',
    );
    expect(parseToml(out).hotkeys["view.toggleNavigator"]).toEqual([]);
    expect(() => applyChanges(src, [{ key: "hotkeys..x", value: [] }])).toThrow(
      /Invalid config key/,
    );
  });
});
