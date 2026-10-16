import { useEffect, type RefObject } from "react";

import { VersionRow } from "./VersionRow";
import { HISTORY_ROW_HEIGHT, useRowWindow } from "./rowWindow";

import type { PanelThumbnails } from "./thumbnails";
import type { VersionInfo } from "../types";

export interface VersionListProps {
  versions: readonly VersionInfo[];
  selectedId: string | null;
  thumbs: PanelThumbnails;
  listRef: RefObject<HTMLUListElement | null>;
  onSelect: (id: string) => void;
  /** +1 = older (Down), -1 = newer (Up). */
  onStep: (delta: 1 | -1) => void;
  onEnter: () => void;
}

/** Windowed list: only the rows near the scroll position are mounted. */
export const VersionList = ({
  versions,
  selectedId,
  thumbs,
  listRef,
  onSelect,
  onStep,
  onEnter,
}: VersionListProps) => {
  const { start, end, scrollToRow } = useRowWindow(listRef, versions.length);

  const selectedIndex = selectedId
    ? versions.findIndex((v) => v.id === selectedId)
    : -1;
  useEffect(() => {
    scrollToRow(selectedIndex);
  }, [selectedIndex, scrollToRow]);

  return (
    <ul
      ref={listRef}
      className="vault-history-panel__list"
      aria-label="Versions"
      tabIndex={0}
      style={{
        paddingTop: start * HISTORY_ROW_HEIGHT,
        paddingBottom: (versions.length - end) * HISTORY_ROW_HEIGHT,
      }}
      onKeyDown={(e) => {
        if (e.key === "ArrowDown") {
          onStep(1);
        } else if (e.key === "ArrowUp") {
          onStep(-1);
        } else if (e.key === "Enter") {
          onEnter();
        } else {
          return;
        }
        e.preventDefault();
      }}
    >
      {versions.slice(start, end).map((v) => (
        <VersionRow
          key={v.id}
          version={v}
          selected={v.id === selectedId}
          thumbs={thumbs}
          onSelect={onSelect}
        />
      ))}
    </ul>
  );
};
