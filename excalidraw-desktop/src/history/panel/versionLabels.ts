import type { HistoryReason, VersionInfo } from "../types";

const REASON_LABELS: Record<HistoryReason, string> = {
  auto: "Automatic",
  leave: "On close",
  checkpoint: "Checkpoint",
  "before-outside-change": "Before outside change",
  "before-restore": "Before restore",
  "before-clear": "Before clear canvas",
  first: "Before first edit",
  recovered: "Recovered",
  "discarded-edits": "Discarded edits",
  moved: "Version",
  unknown: "Version",
};

/** "Checkpoint: <name>", "Automatic", ... unknown reasons read "Version". */
export const versionLabel = (
  v: Pick<VersionInfo, "reason" | "name">,
): string => {
  const base = REASON_LABELS[v.reason] ?? "Version";
  return v.reason === "checkpoint" && v.name ? `${base}: ${v.name}` : base;
};

export const relativeTime = (from: number, now: number): string => {
  const minutes = Math.floor(Math.max(0, now - from) / 60_000);
  if (minutes < 1) {
    return "just now";
  }
  if (minutes < 60) {
    return `${minutes} min ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 48) {
    return `${hours} h ago`;
  }
  return `${Math.floor(hours / 24)} d ago`;
};

export const formatTime = (ms: number) =>
  new Date(ms).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

/** "14:03" for toasts. */
export const formatClock = (ms: number) =>
  new Date(ms).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
