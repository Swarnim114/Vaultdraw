import { useCallback, useEffect, useRef, useState } from "react";

import { errorMessage } from "../../vault/types";
import { IconClose } from "../../components/Icons";

import "./historyPanel.css";

import type {
  HistoryListing,
  HistoryReason,
  HistoryRepository,
  VersionInfo,
} from "../types";

export interface HistoryPanelProps {
  repository: HistoryRepository;
  handle: string;
  /** The open drawing (vault-relative). */
  path: string;
  onClose: () => void;
}

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

const formatTime = (ms: number) =>
  new Date(ms).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

/** H1: a plain list of the open drawing's versions, newest first. */
const HistoryPanel = ({
  repository,
  handle,
  path,
  onClose,
}: HistoryPanelProps) => {
  const [listing, setListing] = useState<HistoryListing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const listRef = useRef<HTMLUListElement>(null);
  const generation = useRef(0);

  const refresh = useCallback(async () => {
    const mine = ++generation.current;
    try {
      const next = await repository.list(handle, path);
      if (mine === generation.current) {
        setListing(next);
        setError(null);
        setNow(Date.now());
      }
    } catch (cause) {
      if (mine === generation.current) {
        setError(errorMessage(cause));
      }
    }
  }, [repository, handle, path]);

  useEffect(() => {
    setListing(null);
    void refresh();
    let off: (() => void) | undefined;
    let disposed = false;
    void repository
      .subscribe((event) => {
        if (event.handle === handle && event.paths.includes(path)) {
          void refresh();
        }
      })
      .then((unsubscribe) => {
        if (disposed) {
          unsubscribe();
        } else {
          off = unsubscribe;
        }
      })
      .catch(() => {});
    return () => {
      disposed = true;
      // The counter is a token, not a node: bumping it cancels late replies.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      generation.current++;
      off?.();
    };
  }, [repository, handle, path, refresh]);

  // Keep "N min ago" honest while the panel is open (one timer, panel only).
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    listRef.current?.focus({ preventScroll: true });
  }, []);

  const versions = listing?.versions ?? [];
  const last = listing?.lastVersionAt ?? null;

  return (
    <aside
      className="vault-history-panel"
      aria-label="History"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <div className="vault-history-panel__header">
        <h3 className="vault-history-panel__title">History</h3>
        <button
          type="button"
          className="vault-btn vault-btn--ghost vault-btn--icon"
          onClick={onClose}
          aria-label="Close history"
        >
          <IconClose />
        </button>
      </div>
      <p className="vault-history-panel__last" data-testid="history-last">
        {listing && !listing.enabled
          ? "History is off"
          : last === null
          ? "No versions yet"
          : `Last version: ${relativeTime(last, now)}`}
      </p>
      {error && <div className="vault-error-text">{error}</div>}
      <ul
        ref={listRef}
        className="vault-history-panel__list"
        aria-label="Versions"
        tabIndex={0}
      >
        {versions.map((v) => (
          <li
            key={v.id}
            className="vault-history-row"
            data-version-id={v.id}
            data-reason={v.reason}
          >
            <span className="vault-history-row__label">{versionLabel(v)}</span>
            <span className="vault-history-row__meta">
              <time dateTime={new Date(v.createdAt).toISOString()}>
                {formatTime(v.createdAt)}
              </time>
              {!v.ownDevice && (
                <span
                  className="vault-history-row__device"
                  title={`Made on another device (${v.device})`}
                >
                  Other device
                </span>
              )}
              {v.availability !== "local" && (
                <span className="vault-history-row__device">
                  {v.availability === "downloading"
                    ? "Downloading"
                    : "Unavailable"}
                </span>
              )}
            </span>
            {v.note && (
              <span className="vault-history-row__note">{v.note}</span>
            )}
          </li>
        ))}
      </ul>
    </aside>
  );
};

export default HistoryPanel;
