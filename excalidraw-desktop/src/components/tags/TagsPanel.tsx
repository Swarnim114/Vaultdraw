import { useMemo, useState } from "react";

import { buildTagTree, type TagNode } from "../../tags/tagTree";
import { tagQuery, type TagCount } from "../../tags/types";
import { IconChevronDown, IconChevronRight } from "../Icons";

import "./TagsPanel.css";

interface TagsPanelProps {
  tags: TagCount[];
  /** Current navigator search query; the tag whose query equals it is active. */
  query: string;
  onQueryChange: (query: string) => void;
}

const countLabel = (count: number) =>
  `${count} ${count === 1 ? "drawing" : "drawings"}`;

interface TagRowsProps {
  nodes: TagNode[];
  depth: number;
  query: string;
  collapsed: Set<string>;
  onToggleNode: (key: string) => void;
  onQueryChange: (query: string) => void;
}

const TagRows = ({
  nodes,
  depth,
  query,
  collapsed,
  onToggleNode,
  onQueryChange,
}: TagRowsProps) => (
  <>
    {nodes.map((node) => {
      const hasChildren = node.children.length > 0;
      const isOpen = hasChildren && !collapsed.has(node.key);
      const q = tagQuery(node.key);
      const isActive = query.trim() === q;
      return (
        <div key={node.key} role="presentation">
          <div
            className={`vault-tags__row ${
              isActive ? "vault-tags__row--active" : ""
            }`}
            style={{ "--depth": depth } as React.CSSProperties}
          >
            {hasChildren ? (
              <button
                type="button"
                className="vault-tags__toggle"
                aria-expanded={isOpen}
                aria-label={`${isOpen ? "Collapse" : "Expand"} ${node.display}`}
                onClick={() => onToggleNode(node.key)}
              >
                {isOpen ? <IconChevronDown /> : <IconChevronRight />}
              </button>
            ) : (
              <span className="vault-tags__toggle" aria-hidden="true" />
            )}
            <button
              type="button"
              className="vault-tags__tag"
              aria-pressed={isActive}
              aria-label={`Tag ${node.display}, ${countLabel(node.count)}`}
              title={q}
              onClick={() => onQueryChange(isActive ? "" : q)}
            >
              <span className="vault-tags__label">#{node.label}</span>
              <span className="vault-tags__count">{node.count}</span>
            </button>
          </div>
          {isOpen && (
            <TagRows
              nodes={node.children}
              depth={depth + 1}
              query={query}
              collapsed={collapsed}
              onToggleNode={onToggleNode}
              onQueryChange={onQueryChange}
            />
          )}
        </div>
      );
    })}
  </>
);

/** Collapsible nested tag list; renders nothing when the vault has no tags. */
export const TagsPanel = ({ tags, query, onQueryChange }: TagsPanelProps) => {
  const [open, setOpen] = useState(true);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const tree = useMemo(() => buildTagTree(tags), [tags]);

  if (tags.length === 0) {
    return null;
  }

  const toggleNode = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (!next.delete(key)) {
        next.add(key);
      }
      return next;
    });

  return (
    <section className="vault-tags" aria-label="Tags">
      <button
        type="button"
        className="vault-tags__header"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {open ? <IconChevronDown /> : <IconChevronRight />}
        <span>Tags</span>
      </button>
      {open && (
        <div className="vault-tags__list">
          <TagRows
            nodes={tree}
            depth={0}
            query={query}
            collapsed={collapsed}
            onToggleNode={toggleNode}
            onQueryChange={onQueryChange}
          />
        </div>
      )}
    </section>
  );
};
