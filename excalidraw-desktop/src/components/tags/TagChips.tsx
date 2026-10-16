import { useSyncExternalStore } from "react";

import { tagKey } from "../../tags/grammar";
import { applyTagFilter } from "../../tags/tagActions";
import { tagStore } from "../../tags/tagStore";

import "./TagsPanel.css";

export const MAX_VISIBLE_CHIPS = 2;

interface TagChipsProps {
  /** Display spellings of the drawing's tags. */
  tags: readonly string[];
  onFilter: (key: string) => void;
  /** Chips shown before "+N" (default MAX_VISIBLE_CHIPS). */
  max?: number;
}

/** Small `#tag` chips after a tree row's name: first two, then "+N". */
export const TagChips = ({
  tags,
  onFilter,
  max = MAX_VISIBLE_CHIPS,
}: TagChipsProps) => {
  if (tags.length === 0) {
    return null;
  }
  const visible = tags.slice(0, max);
  const extra = tags.length - visible.length;
  const all = tags.map((t) => `#${t}`).join(", ");
  return (
    <span className="vault-tag-chips" title={all}>
      {visible.map((tag) => (
        <button
          key={tag}
          type="button"
          className="vault-tag-chip"
          tabIndex={-1}
          aria-label={`Filter by tag ${tag}`}
          onClick={(e) => {
            e.stopPropagation();
            onFilter(tagKey(tag));
          }}
        >
          #{tag}
        </button>
      ))}
      {extra > 0 && <span className="vault-tag-chips__more">+{extra}</span>}
    </span>
  );
};

const DOCK_MAX_CHIPS = 8;

/**
 * The open drawing's tags for the Links dock header, from the tag store (no
 * IPC). Mount it only while the dock is visible: it subscribes on mount.
 */
export const DrawingTags = ({ path }: { path: string | null }) => {
  const tags = useSyncExternalStore(tagStore.subscribe, () =>
    tagStore.pathTags(path),
  );
  if (tags.length === 0) {
    return null;
  }
  return (
    <div className="vault-links__tags" aria-label="Drawing tags">
      <TagChips tags={tags} max={DOCK_MAX_CHIPS} onFilter={applyTagFilter} />
    </div>
  );
};
