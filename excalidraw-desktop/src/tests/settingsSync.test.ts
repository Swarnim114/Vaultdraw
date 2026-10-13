import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_PREFERENCES,
  getPreferences,
  getTheme,
  updatePreferences,
} from "../vault/preferences";
import {
  configToPreferences,
  disposeSettings,
  formatConfigError,
  getSettingsStatus,
  initSettings,
  openConfigDir,
  PREFERENCES_CHANGED_EVENT,
  preferencesToConfigChanges,
  reloadSettings,
  SETTINGS_STATUS_EVENT,
  stateToPreferences,
  type LoadSettingsResult,
} from "../vault/settingsSync";

const DEFAULT_CONFIG = {
  appearance: {
    theme: "Default",
    mode: "system",
    sync_canvas: false,
    canvas_background: "#ffffff",
  },
  editor: {
    font_family: 5,
    font_size: 20,
    stroke_color: "#1e1e1e",
    background_color: "transparent",
    fill_style: "solid",
    stroke_width: 2,
    roughness: 1,
  },
  saving: { autosave_delay_ms: 500 },
};

type Config = Record<string, Record<string, unknown>>;

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

/** Minimal fake of the Rust side: a config object, a state object, events. */
const createBackend = (initial?: {
  config?: Config | null;
  configError?: LoadSettingsResult["configError"];
  state?: Record<string, unknown>;
}) => {
  const backend = {
    config: (initial?.config === undefined
      ? clone(DEFAULT_CONFIG)
      : initial.config) as Config | null,
    configError: initial?.configError ?? null,
    state: initial?.state ?? {},
    handler: null as null | ((e: { payload: unknown }) => void),
    unlisten: vi.fn(),
    invoke: vi.fn(async (cmd: string, args?: Record<string, unknown>) => {
      switch (cmd) {
        case "load_settings":
          return {
            configDir: "/home/u/.config/vaultdraw",
            configPath: "/home/u/.config/vaultdraw/config.toml",
            statePath: "/home/u/.local/state/vaultdraw/state.json",
            config: clone(backend.config),
            configError: backend.configError,
            state: clone(backend.state),
          } as LoadSettingsResult;
        case "update_config": {
          if (!backend.config) {
            throw Object.assign(new Error("config.toml is invalid"), {
              code: "CONFIG_INVALID",
            });
          }
          for (const { key, value } of (args as any).changes) {
            const [table, name] = key.split(".");
            backend.config[table] ??= {};
            if (value === null) {
              delete backend.config[table][name];
            } else {
              backend.config[table][name] = value;
            }
          }
          return undefined;
        }
        case "write_state":
          backend.state = clone((args as any).state);
          return undefined;
        case "open_config_dir":
          return undefined;
        default:
          throw new Error(`unknown command ${cmd}`);
      }
    }),
    listen: vi.fn(async (event: string, handler: any) => {
      expect(event).toBe("config-change");
      backend.handler = handler;
      return backend.unlisten;
    }),
    /** Simulate the file watcher. */
    emitChange: () =>
      backend.handler?.({
        payload: { paths: ["/home/u/.config/vaultdraw/config.toml"] },
      }),
    callsOf: (cmd: string) =>
      backend.invoke.mock.calls.filter(([c]) => c === cmd),
  };
  return backend;
};

const init = (backend: ReturnType<typeof createBackend>) =>
  initSettings(window, {
    tauri: true,
    invoke: backend.invoke as any,
    listen: backend.listen as any,
  });

describe("settingsSync mapping", () => {
  it("formats config errors with and without a line", () => {
    expect(formatConfigError({ message: "bad", line: 3 })).toBe(
      "config.toml line 3: bad",
    );
    expect(formatConfigError({ message: "symlink refused", line: null })).toBe(
      "config.toml: symlink refused",
    );
  });

  it("maps config.toml values to preferences", () => {
    const { values, problems } = configToPreferences({
      appearance: { theme: "Nord", mode: "dark", sync_canvas: true },
      editor: { font_family: 8, roughness: 0, fill_style: "hachure" },
      saving: { autosave_delay_ms: 1000 },
    });
    expect(problems).toEqual([]);
    expect(values).toMatchObject({
      colorTheme: "Nord",
      theme: "dark",
      syncCanvas: true,
      defaultFontFamily: 8,
      defaultRoughness: 0,
      defaultFillStyle: "hachure",
      autosaveDelayMs: 1000,
      // missing keys -> defaults
      defaultFontSize: 20,
      defaultCanvasBackground: "#ffffff",
    });
  });

  it("falls back per field and reports invalid values", () => {
    const { values, problems } = configToPreferences({
      appearance: { mode: "purple", sync_canvas: "yes" },
      editor: { font_family: 4, font_size: 28 },
    });
    expect(values.theme).toBe("system");
    expect(values.syncCanvas).toBe(false);
    expect(values.defaultFontFamily).toBe(5);
    expect(values.defaultFontSize).toBe(28);
    expect(problems.map((p) => p.key)).toEqual([
      "appearance.mode",
      "appearance.sync_canvas",
      "editor.font_family",
    ]);
    expect(problems[0].message).toContain('appearance.mode = "purple"');
  });

  it("maps preference changes to dotted keys, changed keys only", () => {
    const prev = { ...DEFAULT_PREFERENCES };
    const next = {
      ...prev,
      theme: "dark" as const,
      defaultStrokeWidth: 4,
      recentVaults: ["/v"],
    };
    expect(preferencesToConfigChanges(prev, next)).toEqual([
      { key: "appearance.mode", value: "dark" },
      { key: "editor.stroke_width", value: 4 },
    ]);
    expect(preferencesToConfigChanges(prev, { ...prev })).toEqual([]);
  });

  it("maps the phase 2 keys from config.toml", () => {
    const { values, problems } = configToPreferences({
      appearance: { accent_color: "#336699" },
      interface: { zoom: 125 },
      navigator: { sort: "modified_desc" },
      files: { confirm_delete: false, new_drawing_folder: "Inbox/Deep" },
    });
    expect(problems).toEqual([]);
    expect(values).toMatchObject({
      accentColor: "#336699",
      zoom: 125,
      navigatorSort: "modified_desc",
      confirmDelete: false,
      newDrawingFolder: "Inbox/Deep",
    });
  });

  it("defaults the phase 2 keys when absent", () => {
    const { values, problems } = configToPreferences({});
    expect(problems).toEqual([]);
    expect(values).toMatchObject({
      accentColor: DEFAULT_PREFERENCES.accentColor,
      zoom: 100,
      navigatorSort: DEFAULT_PREFERENCES.navigatorSort,
      confirmDelete: true,
      newDrawingFolder: "",
    });
  });

  it.each([
    ["appearance", "accent_color", "blue", "accentColor"],
    ["interface", "zoom", 300, "zoom"],
    ["interface", "zoom", 49, "zoom"],
    ["interface", "zoom", 120.5, "zoom"],
    ["navigator", "sort", "random", "navigatorSort"],
    ["files", "confirm_delete", "no", "confirmDelete"],
    ["files", "new_drawing_folder", "../escape", "newDrawingFolder"],
    ["files", "new_drawing_folder", "/abs", "newDrawingFolder"],
  ] as const)(
    "invalid %s.%s = %j reports a problem and uses the default",
    (table, name, bad, field) => {
      const { values, problems } = configToPreferences({
        [table]: { [name]: bad },
      });
      expect(problems.map((p) => p.key)).toEqual([`${table}.${name}`]);
      expect(values[field]).toBe(DEFAULT_PREFERENCES[field]);
    },
  );

  it("maps phase 2 preference changes to dotted keys", () => {
    const prev = { ...DEFAULT_PREFERENCES };
    const next = {
      ...prev,
      accentColor: "#336699",
      zoom: 150,
      navigatorSort: "name_desc" as const,
      confirmDelete: false,
      newDrawingFolder: "Inbox",
    };
    expect(preferencesToConfigChanges(prev, next)).toEqual(
      expect.arrayContaining([
        { key: "appearance.accent_color", value: "#336699" },
        { key: "interface.zoom", value: 150 },
        { key: "navigator.sort", value: "name_desc" },
        { key: "files.confirm_delete", value: false },
        { key: "files.new_drawing_folder", value: "Inbox" },
      ]),
    );
    expect(preferencesToConfigChanges(prev, next)).toHaveLength(5);
    // and back: values written then read give the same preferences
    const written = Object.fromEntries(
      preferencesToConfigChanges(prev, next).map((c) => [c.key, c.value]),
    );
    const { values } = configToPreferences({
      appearance: { accent_color: written["appearance.accent_color"] },
      interface: { zoom: written["interface.zoom"] },
      navigator: { sort: written["navigator.sort"] },
      files: {
        confirm_delete: written["files.confirm_delete"],
        new_drawing_folder: written["files.new_drawing_folder"],
      },
    });
    expect(values).toMatchObject({
      accentColor: "#336699",
      zoom: 150,
      navigatorSort: "name_desc",
      confirmDelete: false,
      newDrawingFolder: "Inbox",
    });
  });

  it("validates state.json fields", () => {
    expect(
      stateToPreferences({
        recentVaults: ["/a", 3],
        lastVaultPath: "/a",
        navigatorCollapsed: "no",
        navigatorWidth: 300,
        expandedFolders: { "/a": ["", "x"] },
      }),
    ).toEqual({
      recentVaults: [],
      lastVaultPath: "/a",
      navigatorCollapsed: false,
      navigatorWidth: 300,
      expandedFolders: { "/a": ["", "x"] },
      exportOptions: {
        scale: expect.any(Number),
        background: true,
        embedScene: false,
      },
    });
  });
});

describe("settingsSync runtime", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    disposeSettings();
    vi.useRealTimers();
    window.localStorage.clear();
  });

  it("keeps localStorage behaviour in a plain browser", async () => {
    const status = await initSettings(window);
    expect(status.mode).toBe("browser");
    updatePreferences({ theme: "dark" }, window);
    expect(
      window.localStorage.getItem("excalidraw-vault-preferences-v1"),
    ).toContain('"theme":"dark"');
    expect(getTheme(window)).toBe("dark");
  });

  it("hydrates preferences from load_settings", async () => {
    const backend = createBackend({
      config: {
        ...clone(DEFAULT_CONFIG),
        appearance: {
          ...DEFAULT_CONFIG.appearance,
          mode: "dark",
          theme: "Nord",
        },
      },
      state: {
        recentVaults: ["/v1"],
        lastVaultPath: "/v1",
        navigatorWidth: 320,
      },
    });
    const status = await init(backend);
    expect(status.mode).toBe("tauri");
    expect(status.configPath).toBe("/home/u/.config/vaultdraw/config.toml");
    expect(status.problems).toEqual([]);
    const prefs = getPreferences(window);
    expect(prefs.theme).toBe("dark");
    expect(prefs.colorTheme).toBe("Nord");
    expect(prefs.recentVaults).toEqual(["/v1"]);
    expect(prefs.navigatorWidth).toBe(320);
    expect(backend.listen).toHaveBeenCalledTimes(1);
    // nothing written on startup
    expect(backend.callsOf("update_config")).toHaveLength(0);
    expect(backend.callsOf("write_state")).toHaveLength(0);
  });

  it("sends a single update_config with only the changed keys", async () => {
    const backend = createBackend();
    await init(backend);
    const returned = updatePreferences(
      { theme: "dark", defaultFontSize: 20, defaultFontFamily: 6 },
      window,
    );
    // memory first, synchronously
    expect(returned.theme).toBe("dark");
    expect(getTheme(window)).toBe("dark");
    await Promise.resolve();
    await Promise.resolve();
    expect(backend.callsOf("update_config")).toEqual([
      [
        "update_config",
        {
          changes: [
            { key: "appearance.mode", value: "dark" },
            { key: "editor.font_family", value: 6 },
          ],
        },
      ],
    ]);
    // no-op update writes nothing
    updatePreferences({ theme: "dark" }, window);
    await Promise.resolve();
    expect(backend.callsOf("update_config")).toHaveLength(1);
  });

  it("debounces write_state and skips unchanged state", async () => {
    const backend = createBackend({ state: { recentVaults: [] } });
    await init(backend);
    vi.useFakeTimers();
    updatePreferences({ navigatorCollapsed: true }, window);
    updatePreferences({ navigatorWidth: 300 }, window);
    updatePreferences({ recentVaults: ["/v"] }, window);
    expect(backend.callsOf("write_state")).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(299);
    expect(backend.callsOf("write_state")).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(backend.callsOf("write_state")).toHaveLength(1);
    expect(backend.state).toEqual({
      recentVaults: ["/v"],
      lastVaultPath: null,
      navigatorCollapsed: true,
      navigatorWidth: 300,
      expandedFolders: {},
      exportOptions: {
        scale: expect.any(Number),
        background: true,
        embedScene: false,
      },
    });
    // state fields never go to update_config
    expect(backend.callsOf("update_config")).toHaveLength(0);

    // changing and changing back within the window writes nothing
    updatePreferences({ navigatorCollapsed: false }, window);
    updatePreferences({ navigatorCollapsed: true }, window);
    await vi.advanceTimersByTimeAsync(400);
    expect(backend.callsOf("write_state")).toHaveLength(1);
  });

  it("reports invalid file values and uses the field default", async () => {
    const backend = createBackend({
      config: {
        ...clone(DEFAULT_CONFIG),
        appearance: { ...DEFAULT_CONFIG.appearance, mode: "sepia" },
        saving: { autosave_delay_ms: "fast" },
      },
    });
    const status = await init(backend);
    expect(getTheme(window)).toBe("system");
    expect(getPreferences(window).autosaveDelayMs).toBe(500);
    expect(status.problems.map((p) => p.key)).toEqual([
      "appearance.mode",
      "saving.autosave_delay_ms",
    ]);
  });

  it("reloads on config-change and dispatches only when something changed", async () => {
    const backend = createBackend();
    await init(backend);
    const onChange = vi.fn();
    window.addEventListener(PREFERENCES_CHANGED_EVENT, onChange);
    try {
      // our own write echoes back: no event
      updatePreferences({ defaultStrokeWidth: 4 }, window);
      backend.emitChange();
      await reloadSettings();
      expect(onChange).not.toHaveBeenCalled();
      expect(getPreferences(window).defaultStrokeWidth).toBe(4);

      // hand edit: event with the new preferences
      backend.config!.appearance.mode = "light";
      backend.config!.editor.roughness = 2;
      backend.emitChange();
      await reloadSettings();
      expect(onChange).toHaveBeenCalledTimes(1);
      const detail = (onChange.mock.calls[0][0] as CustomEvent).detail;
      expect(detail.theme).toBe("light");
      expect(detail.defaultRoughness).toBe(2);
      expect(getTheme(window)).toBe("light");

      // unchanged file: no further event
      backend.emitChange();
      await reloadSettings();
      expect(onChange).toHaveBeenCalledTimes(1);

      // deleting a line returns that field to its default
      delete backend.config!.editor.roughness;
      await reloadSettings();
      expect(getPreferences(window).defaultRoughness).toBe(1);
      expect(onChange).toHaveBeenCalledTimes(2);
    } finally {
      window.removeEventListener(PREFERENCES_CHANGED_EVENT, onChange);
    }
  });

  it("keeps last good values on a parse error and reports the line", async () => {
    const backend = createBackend();
    backend.config!.appearance.mode = "dark";
    await init(backend);
    const onStatus = vi.fn();
    const onChange = vi.fn();
    window.addEventListener(SETTINGS_STATUS_EVENT, onStatus);
    window.addEventListener(PREFERENCES_CHANGED_EVENT, onChange);
    try {
      backend.config = null;
      backend.configError = { message: "expected `=`", line: 7 };
      await reloadSettings();
      expect(getTheme(window)).toBe("dark");
      expect(onChange).not.toHaveBeenCalled();
      const status = getSettingsStatus();
      expect(status.problems[0]).toMatchObject({
        kind: "parse",
        message: "config.toml line 7: expected `=`",
      });
      expect(onStatus).toHaveBeenCalledTimes(1);

      // same error again: status unchanged, no duplicate event
      await reloadSettings();
      expect(onStatus).toHaveBeenCalledTimes(1);

      // GUI write while broken: memory updates, failure is reported
      updatePreferences({ defaultFontSize: 28 }, window);
      await reloadSettings();
      expect(getPreferences(window).defaultFontSize).toBe(28);
      expect(getSettingsStatus().problems.map((p) => p.kind)).toContain("io");

      // fixed file: problem cleared, values from the file
      backend.config = clone(DEFAULT_CONFIG);
      backend.configError = null;
      updatePreferences({ defaultFontSize: 36 }, window);
      await reloadSettings();
      expect(getSettingsStatus().problems).toEqual([]);
      expect(getPreferences(window).defaultFontSize).toBe(36);
      expect(getTheme(window)).toBe("system");
    } finally {
      window.removeEventListener(SETTINGS_STATUS_EVENT, onStatus);
      window.removeEventListener(PREFERENCES_CHANGED_EVENT, onChange);
    }
  });

  it("migrates machine state from localStorage when state.json is empty", async () => {
    window.localStorage.setItem(
      "excalidraw-vault-preferences-v1",
      JSON.stringify({
        recentVaults: ["/old"],
        lastVaultPath: "/old",
        theme: "dark",
      }),
    );
    const backend = createBackend({ state: {} });
    vi.useFakeTimers();
    await init(backend);
    expect(getPreferences(window).recentVaults).toEqual(["/old"]);
    // config comes from config.toml, not localStorage
    expect(getTheme(window)).toBe("system");
    await vi.advanceTimersByTimeAsync(300);
    expect(backend.state.recentVaults).toEqual(["/old"]);
  });

  it("falls back to localStorage when load_settings fails", async () => {
    const invoke = vi.fn(async () => {
      throw new Error("no such command");
    });
    const status = await initSettings(window, {
      tauri: true,
      invoke: invoke as any,
      listen: vi.fn() as any,
    });
    expect(status.mode).toBe("browser");
    expect(status.problems[0].message).toContain("no such command");
    updatePreferences({ theme: "light" }, window);
    expect(
      window.localStorage.getItem("excalidraw-vault-preferences-v1"),
    ).toContain('"theme":"light"');
  });

  it("opens the config folder and unlistens on dispose", async () => {
    const backend = createBackend();
    await init(backend);
    await openConfigDir();
    expect(backend.callsOf("open_config_dir")).toHaveLength(1);
    disposeSettings();
    expect(backend.unlisten).toHaveBeenCalled();
    await expect(openConfigDir()).rejects.toThrow();
  });
});
