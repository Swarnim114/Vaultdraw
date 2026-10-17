import { useCallback, useEffect, useRef, useState } from "react";

import { useThumbnail, type PanelThumbnails } from "./thumbnails";
import { formatTime, versionLabel } from "./versionLabels";

import type { VersionInfo } from "../types";

/** Wait this long after the last move before the full preview loads. */
export const SCRUB_SETTLE_MS = 120;

export interface TimelineProps {
  /** Newest first, as listed; the slider runs oldest -> newest -> Current. */
  versions: readonly VersionInfo[];
  /** Selected version id; null = the current drawing. */
  selectedId: string | null;
  thumbs: PanelThumbnails;
  /** A stop was reached (after the settle delay). null = Current. */
  onSettle: (id: string | null) => void;
  /** A stop is being dragged over (immediately, for cheap live previews). */
  onScrub?: (id: string | null) => void;
}

const DragCard = ({
  version,
  thumbs,
}: {
  version: VersionInfo;
  thumbs: PanelThumbnails;
}) => {
  const thumb = useThumbnail(thumbs, version);
  return (
    <div
      className="vault-history-timeline__card"
      data-testid="history-scrub-card"
    >
      {thumb && <img src={thumb} alt="" draggable={false} />}
      <span>{versionLabel(version)}</span>
      <time>{formatTime(version.createdAt)}</time>
    </div>
  );
};

/**
 * Accessible scrubber over the versions. While moving it shows only a label
 * and a cached thumbnail; the heavy preview is requested once the pointer or
 * key repeat has been still for SCRUB_SETTLE_MS.
 */
export const Timeline = ({
  versions,
  selectedId,
  thumbs,
  onSettle,
  onScrub,
}: TimelineProps) => {
  const count = versions.length;
  // Stop i (0..count-1) is versions[count-1-i]; stop `count` is Current.
  const idAt = useCallback(
    (stop: number): string | null =>
      stop >= count ? null : versions[count - 1 - stop].id,
    [versions, count],
  );
  const selectedStop =
    selectedId === null
      ? count
      : Math.max(0, count - 1 - versions.findIndex((v) => v.id === selectedId));

  const [dragStop, setDragStop] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  useEffect(
    () => () => {
      if (timer.current) {
        clearTimeout(timer.current);
      }
    },
    [],
  );

  // A selection made elsewhere (list, Previous/Next commands) wins over a
  // pending settle, which would otherwise snap back to the scrubbed stop.
  useEffect(() => {
    if (dragStop !== null && idAt(dragStop) !== selectedId && timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
      setDragStop(null);
    }
    // Only an outside selection change should cancel; dragStop changes are ours.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  const move = useCallback(
    (stop: number) => {
      const next = Math.min(count, Math.max(0, stop));
      setDragStop(next);
      onScrub?.(idAt(next));
      if (timer.current) {
        clearTimeout(timer.current);
      }
      timer.current = setTimeout(() => {
        timer.current = null;
        setDragStop(null);
        onSettle(idAt(next));
      }, SCRUB_SETTLE_MS);
    },
    [count, idAt, onScrub, onSettle],
  );

  const stopFromPointer = (clientX: number): number => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || count === 0) {
      return count;
    }
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    return Math.round(ratio * count);
  };

  const shown = dragStop ?? selectedStop;
  const shownVersion = shown >= count ? null : versions[count - 1 - shown];
  const valueText = shownVersion
    ? `${versionLabel(shownVersion)}, ${formatTime(shownVersion.createdAt)}`
    : "Current";

  const onKeyDown = (e: React.KeyboardEvent) => {
    const delta =
      e.key === "ArrowLeft" ? -1 : e.key === "ArrowRight" ? 1 : null;
    if (delta !== null) {
      move(shown + delta);
    } else if (e.key === "Home") {
      move(0);
    } else if (e.key === "End") {
      move(count);
    } else {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <div className="vault-history-timeline" data-testid="history-timeline">
      {dragStop !== null && shownVersion && (
        <DragCard version={shownVersion} thumbs={thumbs} />
      )}
      {dragStop !== null && !shownVersion && (
        <div className="vault-history-timeline__card">Current</div>
      )}
      <div
        ref={trackRef}
        className="vault-history-timeline__track"
        role="slider"
        tabIndex={0}
        aria-label="Version timeline"
        aria-orientation="horizontal"
        aria-valuemin={0}
        aria-valuemax={count}
        aria-valuenow={shown}
        aria-valuetext={valueText}
        onKeyDown={onKeyDown}
        onPointerDown={(e) => {
          dragging.current = true;
          e.currentTarget.setPointerCapture?.(e.pointerId);
          e.currentTarget.focus({ preventScroll: true });
          move(stopFromPointer(e.clientX));
        }}
        onPointerMove={(e) => {
          if (dragging.current) {
            move(stopFromPointer(e.clientX));
          }
        }}
        onPointerUp={() => {
          dragging.current = false;
        }}
        onPointerCancel={() => {
          dragging.current = false;
        }}
      >
        <span className="vault-history-timeline__rail" />
        <span
          className="vault-history-timeline__thumb"
          style={{ left: `${count === 0 ? 100 : (shown / count) * 100}%` }}
        />
      </div>
      <div className="vault-history-timeline__ends" aria-hidden="true">
        <span>Oldest</span>
        <span>Current</span>
      </div>
    </div>
  );
};
