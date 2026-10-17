import type { HistoryStatus } from "../types";

/** Calm status lines of the panel: over the size cap, disk space low. */
export const HistoryWarnings = ({
  status,
}: {
  status: HistoryStatus | null;
}) => {
  if (!status) {
    return null;
  }
  const lines: string[] = [];
  if (status.overCap === "checkpoints") {
    lines.push(
      "History is over its size limit, and only checkpoints are left to remove. Delete old checkpoints or raise the limit in Settings.",
    );
  } else if (status.overCap === "other-devices") {
    lines.push(
      "History is over its size limit because of versions from other devices. They are thinned as those devices catch up.",
    );
  }
  if (status.lastError?.code === "HISTORY_DISK_LOW") {
    lines.push("Disk space is low, so new versions are paused for now.");
  }
  if (lines.length === 0) {
    return null;
  }
  return (
    <div className="vault-history-panel__warnings" role="status">
      {lines.map((line) => (
        <p key={line}>{line}</p>
      ))}
    </div>
  );
};
