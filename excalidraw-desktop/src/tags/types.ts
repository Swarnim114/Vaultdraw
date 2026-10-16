/** Vault tag payloads (serde camelCase on the Rust side, `vault_tags` command). */
import type { IndexStatus } from "../search/types";

export type TagCount = {
  /** Case/accent-folded key, e.g. "dsa/graphs"; this is what `tag:#key` filters on. */
  tag: string;
  /** Spelling shown in the UI, e.g. "DSA/Graphs". */
  display: string;
  /** Drawings carrying this tag or a child tag. */
  count: number;
};

export type TagsResponse = {
  /** Sorted by key; includes every ancestor of a nested tag. */
  tags: TagCount[];
  /** Vault-relative path to display spellings of its tags (tagged drawings only). */
  byPath: Record<string, string[]>;
  status: IndexStatus;
  tookMs: number;
};

/** Builds the search query that lists drawings with a tag (children included). */
export const tagQuery = (key: string) => `tag:#${key}`;

// ---- P2 contract (frozen): rename a tag across the vault ----
// Rust commands `tags_plan_rename` and `rename_tag` (camelCase serde). The
// background rewrite reuses the links job: journal, revision-checked writes and
// the `links-rewrite-done` event (RewriteDone in ../links/types).

/** `tags_plan_rename(handle, from, to)`: what a rename would touch. Pure query. */
export type TagRenamePlan = {
  /** Folded key of the tag being renamed, e.g. "dsa". */
  from: string;
  /** New display spelling as given (validated by the tag grammar), e.g. "Algo". */
  to: string;
  /** Drawings that would be rewritten (open drawing included). */
  files: number;
  /** Tag tokens that would change (children included). */
  occurrences: number;
  /** The new key already exists in the vault: the rename merges two tags. */
  merges: boolean;
  /** Every distinct key that changes, old -> new (parent first, then children). */
  keys: { from: string; to: string }[];
};

/**
 * `rename_tag(handle, from, to, openPath)`: same shape as a links MoveResult
 * (jobId, plannedFiles, plannedLinks = tag tokens, openDrawingEdits for the
 * open drawing, applied through the editor and undoable).
 */
export type { MoveResult as TagRenameResult } from "../links/types";

/** Client for the two commands (DesktopVaultTagRename.ts; a fake for tests). */
export interface VaultTagRename {
  plan(handle: string, from: string, to: string): Promise<TagRenamePlan>;
  rename(
    handle: string,
    from: string,
    to: string,
    openPath: string | null,
  ): Promise<import("../links/types").MoveResult>;
}

/** `[tags]` in config.toml (global). Defaults follow Obsidian. */
export type TagSort = "name" | "count";
export type TagsSettings = {
  /** tags.autocomplete: the `#` popup while editing text. */
  autocomplete: boolean;
  /** tags.pane_sort: default order of the Tags pane (each vault can override in UI state). */
  paneSort: TagSort;
};
export const DEFAULT_TAGS_SETTINGS: TagsSettings = {
  autocomplete: true,
  paneSort: "name",
};
