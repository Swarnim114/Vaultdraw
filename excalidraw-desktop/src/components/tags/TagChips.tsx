import { tagKey } from "../../tags/grammar";

import "./TagsPanel.css";

export const MAX_VISIBLE_CHIPS = 2;

interface TagChipsProps {
  /** Display spellings of the drawing's tags. */
  tags: string[];
  onFilter: (key: string) => void;
}

/** Small `#tag` chips after a tree row's name: first two, then "+N". */
export const TagChips = ({ tags, onFilter }: TagChipsProps) => {
  if (tags.length === 0) {
    return null;
  }
  const visible = tags.slice(0, MAX_VISIBLE_CHIPS);
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
