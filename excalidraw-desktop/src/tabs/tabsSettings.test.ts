import { describe, expect, it } from "vitest";

import {
  DEFAULT_PREFERENCES,
  normalizePreferences,
} from "../vault/preferences";
import {
  CONFIG_MAPPING,
  configToPreferences,
  preferencesToConfigChanges,
} from "../vault/settingsSync";
import { parseVaultSettings, PER_VAULT_FIELDS } from "../vault/vaultSettings";

import {
  TABS_DEFAULTS,
  TABS_FIELDS,
  TABS_MAPPINGS,
  TABS_VAULT_FIELDS,
  normalizeTabsPreferences,
} from "./tabsSettings";
import { TABS_SETTINGS_SCHEMA } from "./tabsSettingsSchema";

const KEYS = {
  tabsEnabled: "tabs.enabled",
  tabsShowStrip: "tabs.show_strip",
  tabsOpenFromNavigator: "tabs.open_from_navigator",
  tabsFocusNew: "tabs.focus_new",
  tabsNewTabPosition: "tabs.new_tab_position",
  tabsCtrlTab: "tabs.ctrl_tab",
  tabsClosePinned: "tabs.close_pinned",
  tabsRestore: "tabs.restore",
  tabsUndoBudgetMb: "tabs.undo_budget_mb",
} as const;

// A non-default valid value per field.
const ALT = {
  tabsEnabled: false,
  tabsShowStrip: "never",
  tabsOpenFromNavigator: "new",
  tabsFocusNew: false,
  tabsNewTabPosition: "end",
  tabsCtrlTab: "order",
  tabsClosePinned: true,
  tabsRestore: false,
  tabsUndoBudgetMb: 0,
} as const;

const toml = (key: string, value: unknown) => {
  const [section, name] = key.split(".");
  return { [section]: { [name]: value } };
};

describe("tabs defaults", () => {
  it("match the plan and live in the preferences", () => {
    expect(TABS_DEFAULTS).toEqual({
      tabsEnabled: true,
      tabsShowStrip: "always",
      tabsOpenFromNavigator: "current",
      tabsFocusNew: true,
      tabsNewTabPosition: "after_active",
      tabsCtrlTab: "mru",
      tabsClosePinned: false,
      tabsRestore: true,
      tabsUndoBudgetMb: 32,
    });
    for (const f of TABS_FIELDS) {
      expect(DEFAULT_PREFERENCES[f]).toBe(TABS_DEFAULTS[f]);
    }
  });
});

describe("config.toml mapping", () => {
  it("maps every field to its [tabs] key, once", () => {
    expect(
      CONFIG_MAPPING.filter((m) => m.key.startsWith("tabs.")),
    ).toHaveLength(TABS_FIELDS.length);
    expect(TABS_MAPPINGS.map((m) => [m.field, m.key])).toEqual(
      TABS_FIELDS.map((f) => [f, KEYS[f]]),
    );
  });

  it.each(TABS_FIELDS)("round trips %s", (field) => {
    const { values, problems } = configToPreferences(
      toml(KEYS[field], ALT[field]),
    );
    expect(problems).toEqual([]);
    expect(values[field]).toBe(ALT[field]);
    expect(
      preferencesToConfigChanges(DEFAULT_PREFERENCES, {
        ...DEFAULT_PREFERENCES,
        [field]: ALT[field],
      }),
    ).toEqual([{ key: KEYS[field], value: ALT[field] }]);
  });

  it("defaults missing keys", () => {
    const { values, problems } = configToPreferences({});
    expect(problems).toEqual([]);
    for (const f of TABS_FIELDS) {
      expect(values[f]).toBe(TABS_DEFAULTS[f]);
    }
  });

  it.each([
    ["enabled", "yes"],
    ["show_strip", "sometimes"],
    ["open_from_navigator", true],
    ["focus_new", 1],
    ["new_tab_position", "start"],
    ["ctrl_tab", "recent"],
    ["close_pinned", "false"],
    ["restore", null],
    ["undo_budget_mb", -1],
    ["undo_budget_mb", 1025],
    ["undo_budget_mb", 1.5],
    ["undo_budget_mb", "32"],
  ])("rejects tabs.%s = %j with a problem and the default", (name, bad) => {
    const key = `tabs.${name}`;
    const { values, problems } = configToPreferences({
      tabs: { [name]: bad },
    });
    expect(problems).toHaveLength(1);
    expect(problems[0].message).toContain(key);
    const field = TABS_FIELDS.find((f) => KEYS[f] === key)!;
    expect(values[field]).toBe(TABS_DEFAULTS[field]);
  });

  it("accepts the budget edges", () => {
    for (const v of [0, 1024]) {
      const { values, problems } = configToPreferences({
        tabs: { undo_budget_mb: v },
      });
      expect(problems).toEqual([]);
      expect(values.tabsUndoBudgetMb).toBe(v);
    }
  });
});

describe("stored preferences", () => {
  it("normalizes bad stored values to defaults", () => {
    expect(
      normalizeTabsPreferences({
        tabsEnabled: "no",
        tabsCtrlTab: "order",
        tabsUndoBudgetMb: 5000,
      }),
    ).toEqual({ ...TABS_DEFAULTS, tabsCtrlTab: "order" });
    expect(normalizePreferences({ tabsRestore: false }).tabsRestore).toBe(
      false,
    );
  });
});

describe("per-vault settings", () => {
  it("lists exactly open_from_navigator and restore", () => {
    expect([...TABS_VAULT_FIELDS].sort()).toEqual(
      ["tabsOpenFromNavigator", "tabsRestore"].sort(),
    );
    for (const f of TABS_VAULT_FIELDS) {
      expect(PER_VAULT_FIELDS).toContain(f);
    }
    for (const f of TABS_FIELDS) {
      if (!(TABS_VAULT_FIELDS as readonly string[]).includes(f)) {
        expect(PER_VAULT_FIELDS as readonly string[]).not.toContain(f);
      }
    }
  });

  it("parses [tabs] from settings.toml, ignoring invalid values", () => {
    const { overrides, problems } = parseVaultSettings({
      tabs: { open_from_navigator: "new", restore: "x" },
    });
    expect(overrides).toEqual({ tabsOpenFromNavigator: "new" });
    expect(problems).toHaveLength(1);
    expect(problems[0].message).toContain("tabs.restore");
  });
});

describe("schema rows", () => {
  it("has one row per field on the Interface page, per-vault flags match", () => {
    expect(TABS_SETTINGS_SCHEMA.map((r) => r.configKey)).toEqual(
      TABS_FIELDS.map((f) => KEYS[f]),
    );
    for (const r of TABS_SETTINGS_SCHEMA) {
      expect(r.page).toBe("interface");
    }
    expect(
      TABS_SETTINGS_SCHEMA.filter((r) => r.perVault).map((r) => r.configKey),
    ).toEqual(["tabs.open_from_navigator", "tabs.restore"]);
  });
});
