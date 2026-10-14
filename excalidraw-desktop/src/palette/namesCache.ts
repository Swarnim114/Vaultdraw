import type { IndexStatus, VaultSearch } from "../search/types";

export interface Names {
  paths: readonly string[];
  status: IndexStatus | null;
  error: string | null;
}

/**
 * Last drawing-name listing per vault, kept across palette openings: the next
 * opening paints from it at once and the fresh listing replaces it on arrival.
 */
export const namesCache = new Map<string, Names>();

/** Fill the cache ahead of the first opening (call when the vault is idle). */
export async function primeNames(
  search: Pick<VaultSearch, "listNames">,
  handle: string,
): Promise<void> {
  if (namesCache.has(handle)) {
    return;
  }
  try {
    const listing = await search.listNames(handle);
    if (!namesCache.has(handle)) {
      namesCache.set(handle, {
        paths: listing.paths,
        status: listing.status,
        error: null,
      });
    }
  } catch {
    // The palette lists again when it opens and reports the error itself.
  }
}
