/**
 * History settings: preference fields, config.toml keys (`[history]`),
 * validation, defaults and the per-vault capable field list. Everything here
 * is pure data; settingsSync.ts / vaultSettings.ts / preferences.ts spread
 * `HISTORY_MAPPINGS`, `HISTORY_FIELDS` and `HISTORY_DEFAULTS` in.
 */
import type { ConfigMapping } from "../vault/settingsSync";
import type { HistorySettings } from "./types";

export const HISTORY_FIELDS = [
  "historyEnabled",
  "historyIntervalMinutes",
  "historyKeepAllHours",
  "historyKeepHourlyHours",
  "historyKeepDailyDays",
  "historyKeepWeeklyWeeks",
  "historySizeCapMb",
  "historyHighlightChanges",
] as const;
export type HistoryField = typeof HISTORY_FIELDS[number];

export interface HistoryPreferences {
  /** Kill switch: false = no versions are made at all. */
  historyEnabled: boolean;
  /** Minutes between timed versions; 0 = no timed versions. */
  historyIntervalMinutes: number;
  /** Keep every version for this many hours. */
  historyKeepAllHours: number;
  /** Then keep one per hour for this many hours. */
  historyKeepHourlyHours: number;
  /** Then keep one per day for this many days. */
  historyKeepDailyDays: number;
  /** Then keep one per week for this many weeks; 0 = forever. */
  historyKeepWeeklyWeeks: number;
  /** Size cap per vault in MB; 0 = none. */
  historySizeCapMb: number;
  /** Highlight what changed in the History preview. */
  historyHighlightChanges: boolean;
}

export const HISTORY_DEFAULTS: HistoryPreferences = {
  historyEnabled: true,
  historyIntervalMinutes: 5,
  historyKeepAllHours: 1,
  historyKeepHourlyHours: 24,
  historyKeepDailyDays: 30,
  historyKeepWeeklyWeeks: 0,
  historySizeCapMb: 500,
  historyHighlightChanges: true,
};

interface IntRange {
  min: number;
  max: number;
}

/** Inclusive integer ranges of the numeric fields. */
type NumericField = Exclude<
  HistoryField,
  "historyEnabled" | "historyHighlightChanges"
>;

export const HISTORY_LIMITS: Readonly<Record<NumericField, IntRange>> = {
  historyIntervalMinutes: { min: 0, max: 1440 },
  historyKeepAllHours: { min: 0, max: 720 },
  historyKeepHourlyHours: { min: 0, max: 8760 },
  historyKeepDailyDays: { min: 0, max: 3650 },
  historyKeepWeeklyWeeks: { min: 0, max: 5200 },
  historySizeCapMb: { min: 0, max: 1_000_000 },
};

const isBool = (v: unknown): v is boolean => typeof v === "boolean";
const inLimits = (field: NumericField) => (v: unknown) =>
  typeof v === "number" &&
  Number.isInteger(v) &&
  v >= HISTORY_LIMITS[field].min &&
  v <= HISTORY_LIMITS[field].max;

const number = (
  field: NumericField,
  key: string,
  what: string,
): ConfigMapping => ({
  field,
  key,
  expected: `a whole number from ${HISTORY_LIMITS[field].min} to ${HISTORY_LIMITS[field].max} (${what})`,
  valid: inLimits(field),
});

export const HISTORY_MAPPINGS: readonly ConfigMapping[] = [
  {
    field: "historyEnabled",
    key: "history.enabled",
    expected: "true or false",
    valid: isBool,
  },
  number(
    "historyIntervalMinutes",
    "history.interval_minutes",
    "0 = no timed versions",
  ),
  number("historyKeepAllHours", "history.keep_all_hours", "hours"),
  number("historyKeepHourlyHours", "history.keep_hourly_hours", "hours"),
  number("historyKeepDailyDays", "history.keep_daily_days", "days"),
  number(
    "historyKeepWeeklyWeeks",
    "history.keep_weekly_weeks",
    "0 = keep weekly versions forever",
  ),
  number("historySizeCapMb", "history.size_cap_mb", "megabytes, 0 = no cap"),
  {
    field: "historyHighlightChanges",
    key: "history.highlight_changes",
    expected: "true or false",
    valid: isBool,
  },
];

const VALID: Record<HistoryField, (v: unknown) => boolean> = {
  historyEnabled: isBool,
  historyIntervalMinutes: inLimits("historyIntervalMinutes"),
  historyKeepAllHours: inLimits("historyKeepAllHours"),
  historyKeepHourlyHours: inLimits("historyKeepHourlyHours"),
  historyKeepDailyDays: inLimits("historyKeepDailyDays"),
  historyKeepWeeklyWeeks: inLimits("historyKeepWeeklyWeeks"),
  historySizeCapMb: inLimits("historySizeCapMb"),
  historyHighlightChanges: isBool,
};

/** Stored (localStorage) preferences -> valid history fields; bad ones default. */
export function normalizeHistoryPreferences(
  input: Record<string, unknown>,
): HistoryPreferences {
  return Object.fromEntries(
    HISTORY_FIELDS.map((field) => [
      field,
      VALID[field](input[field]) ? input[field] : HISTORY_DEFAULTS[field],
    ]),
  ) as unknown as HistoryPreferences;
}

/** The effective (global + per-vault) fields as the IPC settings object. */
export const toHistorySettings = (
  prefs: HistoryPreferences,
): HistorySettings => ({
  enabled: prefs.historyEnabled,
  intervalMinutes: prefs.historyIntervalMinutes,
  keepAllHours: prefs.historyKeepAllHours,
  keepHourlyHours: prefs.historyKeepHourlyHours,
  keepDailyDays: prefs.historyKeepDailyDays,
  keepWeeklyWeeks: prefs.historyKeepWeeklyWeeks,
  sizeCapMb: prefs.historySizeCapMb,
  highlightChanges: prefs.historyHighlightChanges,
});
