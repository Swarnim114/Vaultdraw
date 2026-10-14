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
