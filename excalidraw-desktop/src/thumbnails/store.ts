/** Persistent thumbnail cache behind the service (native = Rust, tests/e2e = fake). */

export type LookupState = "hit" | "miss" | "failed" | "missing" | "pending";
export type LookupItem = { rev: string | null; state: LookupState };
export type LookupResult = { vaultId: string; items: LookupItem[] };

export interface ThumbnailStore {
  /** One item per path, same order. `pending` = retry on the next frame. */
  lookup(
    handle: string,
    paths: string[],
    renderVersion: number,
  ): Promise<LookupResult>;
  /** `png` null stores a fail marker. Resolves the image url (null for a marker). */
  put(
    handle: string,
    path: string,
    rev: string,
    png: Blob | null,
    renderVersion: number,
  ): Promise<string | null>;
  urlFor(vaultId: string, rev: string): string;
  clear(handle: string): Promise<void>;
}

/** Max paths per lookup call (the Rust side rejects more). */
export const LOOKUP_BATCH_MAX = 500;
