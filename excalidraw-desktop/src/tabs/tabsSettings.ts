/**
 * Tabs settings: preference fields, config.toml keys (`[tabs]`), validation,
 * defaults and the per-vault capable field list. Pure data; settingsSync.ts /
 * vaultSettings.ts / preferences.ts spread `TABS_MAPPINGS`, `TABS_FIELDS` and
 * `TABS_DEFAULTS` in.
 */
import type { ConfigMapping } from "../vault/settingsSync";

export const TABS_FIELDS = [
  "tabsEnabled",
  "tabsShowStrip",
  "tabsOpenFromNavigator",
  "tabsFocusNew",
  "tabsNewTabPosition",
  "tabsCtrlTab",
  "tabsClosePinned",
  "tabsRestore",
  "tabsUndoBudgetMb",
] as const;
export type TabsField = typeof TABS_FIELDS[number];

/** Fields a vault may override (a subset of TABS_FIELDS). */
export const TABS_VAULT_FIELDS = [
  "tabsOpenFromNavigator",
  "tabsRestore",
] as const;

export const TABS_SHOW_STRIP = ["always", "never"] as const;
export const TABS_OPEN_FROM_NAVIGATOR = ["current", "new"] as const;
export const TABS_NEW_TAB_POSITION = ["after_active", "end"] as const;
export const TABS_CTRL_TAB = ["mru", "order"] as const;

export const TABS_UNDO_BUDGET_MB = { min: 0, max: 1024 } as const;

export interface TabsPreferences {
  /** false = single-drawing behaviour, no strip. */
  tabsEnabled: boolean;
  tabsShowStrip: typeof TABS_SHOW_STRIP[number];
  tabsOpenFromNavigator: typeof TABS_OPEN_FROM_NAVIGATOR[number];
  /** A drawing opened in a new tab becomes the active one. */
  tabsFocusNew: boolean;
  tabsNewTabPosition: typeof TABS_NEW_TAB_POSITION[number];
  tabsCtrlTab: typeof TABS_CTRL_TAB[number];
  /** Cmd+W may close pinned tabs. */
  tabsClosePinned: boolean;
  /** Reopen the open tabs of a vault when it opens. */
  tabsRestore: boolean;
  /** MB of undo history kept for background tabs; 0 = none. */
  tabsUndoBudgetMb: number;
}

export const TABS_DEFAULTS: TabsPreferences = {
  tabsEnabled: true,
  tabsShowStrip: "always",
  tabsOpenFromNavigator: "current",
  tabsFocusNew: true,
  tabsNewTabPosition: "after_active",
  tabsCtrlTab: "mru",
  tabsClosePinned: false,
  tabsRestore: true,
  tabsUndoBudgetMb: 32,
};

const isBool = (v: unknown): v is boolean => typeof v === "boolean";
const oneOf =
  (options: readonly string[]) =>
  (v: unknown): boolean =>
    typeof v === "string" && options.includes(v);
const isBudget = (v: unknown): boolean =>
  typeof v === "number" &&
  Number.isInteger(v) &&
  v >= TABS_UNDO_BUDGET_MB.min &&
  v <= TABS_UNDO_BUDGET_MB.max;

const choice = (
  field: TabsField,
  key: string,
  options: readonly string[],
): ConfigMapping => ({
  field,
  key,
  expected: options.map((o) => `"${o}"`).join(" or "),
  valid: oneOf(options),
});

const bool = (field: TabsField, key: string): ConfigMapping => ({
  field,
  key,
  expected: "true or false",
  valid: isBool,
});

export const TABS_MAPPINGS: readonly ConfigMapping[] = [
  bool("tabsEnabled", "tabs.enabled"),
  choice("tabsShowStrip", "tabs.show_strip", TABS_SHOW_STRIP),
  choice(
    "tabsOpenFromNavigator",
    "tabs.open_from_navigator",
    TABS_OPEN_FROM_NAVIGATOR,
  ),
  bool("tabsFocusNew", "tabs.focus_new"),
  choice("tabsNewTabPosition", "tabs.new_tab_position", TABS_NEW_TAB_POSITION),
  choice("tabsCtrlTab", "tabs.ctrl_tab", TABS_CTRL_TAB),
  bool("tabsClosePinned", "tabs.close_pinned"),
  bool("tabsRestore", "tabs.restore"),
  {
    field: "tabsUndoBudgetMb",
    key: "tabs.undo_budget_mb",
    expected: `a whole number from ${TABS_UNDO_BUDGET_MB.min} to ${TABS_UNDO_BUDGET_MB.max} (megabytes, 0 = no undo kept for background tabs)`,
    valid: isBudget,
  },
];

const VALID: Record<TabsField, (v: unknown) => boolean> = {
  tabsEnabled: isBool,
  tabsShowStrip: oneOf(TABS_SHOW_STRIP),
  tabsOpenFromNavigator: oneOf(TABS_OPEN_FROM_NAVIGATOR),
  tabsFocusNew: isBool,
  tabsNewTabPosition: oneOf(TABS_NEW_TAB_POSITION),
  tabsCtrlTab: oneOf(TABS_CTRL_TAB),
  tabsClosePinned: isBool,
  tabsRestore: isBool,
  tabsUndoBudgetMb: isBudget,
};

/** Stored (localStorage) preferences -> valid tabs fields; bad ones default. */
export function normalizeTabsPreferences(
  input: Record<string, unknown>,
): TabsPreferences {
  return Object.fromEntries(
    TABS_FIELDS.map((field) => [
      field,
      VALID[field](input[field]) ? input[field] : TABS_DEFAULTS[field],
    ]),
  ) as unknown as TabsPreferences;
}
