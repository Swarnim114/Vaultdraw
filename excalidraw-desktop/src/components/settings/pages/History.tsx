import { useCallback, useEffect, useState } from "react";

import { desktopHistoryRepository } from "../../../history/DesktopHistoryRepository";
import { useHistoryBridge } from "../../../history/historyBridge";
import { deleteAllConfirm } from "../../../history/historyConfirms";
import {
  HISTORY_DEFAULTS,
  HISTORY_LIMITS,
} from "../../../history/historySettings";
import { toastStore } from "../../../toasts/toastStore";
import { errorMessage } from "../../../vault/types";
import { ConfirmModal } from "../../ConfirmModal";
import { SettingRow } from "../SettingRow";
import { useSettings, type SettingControls } from "../SettingsContext";

import { Stepper, Switch } from "./controls";
import { PerVaultRow } from "./perVault";

import "./history.css";

import type { HistoryRepository, HistoryStatus } from "../../../history/types";

type NumericField = keyof typeof HISTORY_LIMITS;

const MB = 1024 * 1024;

/** "12.3 MB", "850 KB". */
export const formatBytes = (bytes: number): string => {
  if (bytes >= 1024 * MB) {
    return `${(bytes / (1024 * MB)).toFixed(1)} GB`;
  }
  if (bytes >= MB) {
    return `${(bytes / MB).toFixed(1)} MB`;
  }
  return `${Math.max(0, Math.round(bytes / 1024))} KB`;
};

// ---- status: read while the page is open, refreshed after actions ----------

const refreshers = new Set<() => void>();
const refreshAll = () => refreshers.forEach((r) => r());

/** `history_status` of the open vault, read on mount and after `refreshAll()`. */
const usePageStatus = (): {
  status: HistoryStatus | null;
  repository: HistoryRepository;
  handle: string | null;
  path: string | null;
  readOnly: boolean;
} => {
  const { vault } = useSettings();
  const bridge = useHistoryBridge();
  const repository = bridge?.repository ?? desktopHistoryRepository;
  const handle = bridge?.handle ?? vault?.handle ?? null;
  const [status, setStatus] = useState<HistoryStatus | null>(null);
  const load = useCallback(() => {
    if (!handle) {
      setStatus(null);
      return;
    }
    repository.status(handle).then(setStatus, () => setStatus(null));
  }, [repository, handle]);
  useEffect(() => {
    load();
    refreshers.add(load);
    return () => {
      refreshers.delete(load);
    };
  }, [load]);
  return {
    status,
    repository,
    handle,
    path: bridge?.path ?? null,
    readOnly: bridge?.readOnly ?? vault?.readOnly ?? false,
  };
};

// ---- controls ---------------------------------------------------------------

const NumberField = ({
  field,
  value,
  label,
  unit,
  step = 1,
  onCommit,
}: {
  field: NumericField;
  value: number;
  label: string;
  unit: string;
  step?: number;
  onCommit: (next: number) => void;
}) => (
  <Stepper
    label={label}
    unit={unit}
    {...HISTORY_LIMITS[field]}
    step={step}
    value={value}
    onChange={onCommit}
  />
);

const EnabledSetting = () => (
  <PerVaultRow id="history-enabled" field="historyEnabled">
    {(value, onChange) => (
      <Switch
        checked={value}
        label="Enable history"
        onChange={(next) => onChange(next)}
      />
    )}
  </PerVaultRow>
);

const numberSetting = (
  id: string,
  field: NumericField,
  label: string,
  unit: string,
) => {
  const Component = () => {
    const { setPerVaultValue } = useSettings();
    return (
      <PerVaultRow
        id={id}
        field={field}
        onReset={() => setPerVaultValue(field, HISTORY_DEFAULTS[field])}
      >
        {(value, onChange) => (
          <NumberField
            field={field}
            value={value}
            label={label}
            unit={unit}
            onCommit={onChange}
          />
        )}
      </PerVaultRow>
    );
  };
  return Component;
};

const IntervalSetting = numberSetting(
  "history-interval",
  "historyIntervalMinutes",
  "Version interval in minutes",
  "min",
);
const KeepAllSetting = numberSetting(
  "history-keep-all",
  "historyKeepAllHours",
  "Keep every version for hours",
  "hours",
);
const KeepHourlySetting = numberSetting(
  "history-keep-hourly",
  "historyKeepHourlyHours",
  "Keep one per hour for hours",
  "hours",
);
const KeepDailySetting = numberSetting(
  "history-keep-daily",
  "historyKeepDailyDays",
  "Keep one per day for days",
  "days",
);
const KeepWeeklySetting = numberSetting(
  "history-keep-weekly",
  "historyKeepWeeklyWeeks",
  "Keep one per week for weeks",
  "weeks",
);

const RETENTION_FIELDS = [
  "historyKeepAllHours",
  "historyKeepHourlyHours",
  "historyKeepDailyDays",
  "historyKeepWeeklyWeeks",
] as const;

const PresetSetting = () => {
  const { setPerVaultValue, vaultSettings } = useSettings();
  const isDefault = RETENTION_FIELDS.every(
    (f) => vaultSettings.effective[f] === HISTORY_DEFAULTS[f],
  );
  return (
    <SettingRow id="history-retention-preset">
      <button
        type="button"
        className="vault-btn"
        disabled={isDefault}
        onClick={() =>
          RETENTION_FIELDS.forEach((f) =>
            setPerVaultValue(f, HISTORY_DEFAULTS[f]),
          )
        }
      >
        Time Machine defaults
      </button>
    </SettingRow>
  );
};

/** Used space against the cap, with the checkpoints' share marked. */
export const UsageBar = ({
  status,
  capMb,
}: {
  status: HistoryStatus;
  capMb: number;
}) => {
  const cap = capMb * MB;
  const total = status.totalBytes;
  const pct = cap > 0 ? Math.min(100, (total / cap) * 100) : 0;
  const checkpointPct =
    cap > 0 ? Math.min(pct, (status.checkpointBytes / cap) * 100) : 0;
  const text =
    cap > 0
      ? `${formatBytes(total)} of ${formatBytes(cap)} used`
      : `${formatBytes(total)} used, no limit`;
  return (
    <div className="vault-history-usage" data-testid="history-usage">
      {cap > 0 && (
        <div
          className="vault-history-usage__bar"
          role="progressbar"
          aria-label="History size"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(pct)}
        >
          <span
            className="vault-history-usage__fill"
            style={{ width: `${pct}%` }}
          />
          <span
            className="vault-history-usage__checkpoints"
            style={{ width: `${checkpointPct}%` }}
          />
        </div>
      )}
      <div className="vault-history-usage__text">
        {text}
        {status.checkpointBytes > 0 &&
          `, of which checkpoints ${formatBytes(status.checkpointBytes)}`}
      </div>
    </div>
  );
};

const capNotes = (status: HistoryStatus): string[] => {
  const notes: string[] = [];
  if (status.overCap === "checkpoints") {
    notes.push(
      "History is over its limit, and only checkpoints are left to remove. Delete old checkpoints or raise the limit.",
    );
  } else if (status.overCap === "other-devices") {
    notes.push(
      "History is over its limit because of versions from other devices. They are thinned as those devices catch up.",
    );
  }
  if (status.gcBlocked) {
    notes.push(
      "Thinning is paused until this vault finishes syncing, so history may stay above the limit for now.",
    );
  }
  return notes;
};

const SizeCapSetting = () => {
  const { status } = usePageStatus();
  const { vaultSettings } = useSettings();
  const capMb = vaultSettings.effective.historySizeCapMb;
  return (
    <PerVaultRow
      id="history-size-cap"
      field="historySizeCapMb"
      details={
        status && (
          <>
            <UsageBar status={status} capMb={capMb} />
            {capNotes(status).map((n) => (
              <div key={n} className="vault-history-note-line" role="status">
                {n}
              </div>
            ))}
          </>
        )
      }
    >
      {(value, onChange) => (
        <NumberField
          field="historySizeCapMb"
          value={value}
          label="Size limit in megabytes"
          unit="MB"
          step={50}
          onCommit={onChange}
        />
      )}
    </PerVaultRow>
  );
};

const HighlightSetting = () => (
  <PerVaultRow id="history-highlight" field="historyHighlightChanges">
    {(value, onChange) => (
      <Switch
        checked={value}
        label="Highlight changes in preview"
        onChange={(next) => onChange(next)}
      />
    )}
  </PerVaultRow>
);

const PrivacySetting = () => <SettingRow id="history-privacy" />;

const GitSetting = () => {
  const { status, repository, handle, readOnly } = usePageStatus();
  if (!status?.gitRepo || !handle) {
    return null;
  }
  const excluded = status.gitExcluded;
  return (
    <SettingRow id="history-git">
      <button
        type="button"
        className="vault-btn"
        disabled={excluded || readOnly}
        onClick={() => {
          repository
            .excludeFromGit(handle)
            .then(refreshAll, (cause) =>
              toastStore.push({ message: errorMessage(cause), kind: "error" }),
            );
        }}
      >
        {excluded ? "Excluded" : "Exclude history from git"}
      </button>
    </SettingRow>
  );
};

const DeleteAllSetting = () => {
  const { repository, handle, path, readOnly } = usePageStatus();
  const [confirming, setConfirming] = useState(false);
  const run = () => {
    setConfirming(false);
    if (!handle || !path) {
      return;
    }
    repository.deleteAll(handle, path).then(
      () => {
        toastStore.push({ message: "History of the open drawing deleted." });
        refreshAll();
      },
      (cause) =>
        toastStore.push({ message: errorMessage(cause), kind: "error" }),
    );
  };
  return (
    <SettingRow
      id="history-delete-all"
      details={
        !path && (
          <div className="vault-history-note-line">
            Open a drawing to delete its history.
          </div>
        )
      }
    >
      <button
        type="button"
        className="vault-btn vault-btn--danger"
        disabled={!handle || !path || readOnly}
        onClick={() => setConfirming(true)}
      >
        Delete all history…
      </button>
      {confirming && path && (
        <ConfirmModal
          {...deleteAllConfirm(path)}
          onConfirm={run}
          onCancel={() => setConfirming(false)}
        />
      )}
    </SettingRow>
  );
};

export const historyControls: SettingControls = {
  "history-enabled": { Component: EnabledSetting },
  "history-interval": { Component: IntervalSetting },
  "history-keep-all": { Component: KeepAllSetting },
  "history-keep-hourly": { Component: KeepHourlySetting },
  "history-keep-daily": { Component: KeepDailySetting },
  "history-keep-weekly": { Component: KeepWeeklySetting },
  "history-retention-preset": { Component: PresetSetting },
  "history-size-cap": { Component: SizeCapSetting },
  "history-highlight": { Component: HighlightSetting },
  "history-privacy": { Component: PrivacySetting },
  "history-git": { Component: GitSetting },
  "history-delete-all": { Component: DeleteAllSetting },
};
