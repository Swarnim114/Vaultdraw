import { memo } from "react";

import { IconTrash } from "../../components/Icons";

import { formatTime, versionLabel } from "./versionLabels";
import { useThumbnail, type PanelThumbnails } from "./thumbnails";

import type { VersionInfo } from "../types";

export interface VersionRowProps {
  version: VersionInfo;
  selected: boolean;
  thumbs: PanelThumbnails;
  onSelect: (id: string) => void;
  /** Offered on checkpoint rows only. */
  onDelete?: (id: string) => void;
}

/** Memoised: a scrub or a 30 s tick re-renders only the rows whose props change. */
const VersionRowImpl = ({
  version: v,
  selected,
  thumbs,
  onSelect,
  onDelete,
}: VersionRowProps) => {
  const thumb = useThumbnail(thumbs, v);
  return (
    <li
      className="vault-history-row"
      data-version-id={v.id}
      data-reason={v.reason}
      data-selected={selected ? "true" : undefined}
      aria-current={selected ? "true" : undefined}
      onClick={() => onSelect(v.id)}
    >
      <span className="vault-history-row__thumb" aria-hidden="true">
        {thumb && <img src={thumb} alt="" draggable={false} />}
      </span>
      <span className="vault-history-row__body">
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
              {v.availability === "downloading" ? "Downloading" : "Unavailable"}
            </span>
          )}
        </span>
        {v.note && (
          <span className="vault-history-row__note" title={v.note}>
            {v.note}
          </span>
        )}
      </span>
      {onDelete && v.reason === "checkpoint" && (
        <button
          type="button"
          className="vault-btn vault-btn--ghost vault-btn--icon vault-history-row__delete"
          aria-label={`Delete ${versionLabel(v)}`}
          title="Delete checkpoint"
          onClick={(e) => {
            e.stopPropagation();
            onDelete(v.id);
          }}
          // The list handles Enter (restore); a button press must stay its own.
          onKeyDown={(e) => e.stopPropagation()}
        >
          <IconTrash width="14" height="14" />
        </button>
      )}
    </li>
  );
};

export const VersionRow = memo(VersionRowImpl);
