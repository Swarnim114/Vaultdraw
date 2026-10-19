/**
 * In-memory thumbnail store for vitest and the browser harness (which cannot
 * serve vdthumb:). Revisions come from the injected `revisionOf` (usually the
 * fake repository); image urls are blob:/data: urls held in memory.
 */
import type { LookupItem, ThumbnailStore } from "./store";

export interface FakeThumbnailStore extends ThumbnailStore {
  readonly calls: {
    lookup: number;
    put: number;
    clear: number;
    /** Paths of every lookup call. */
    lookupPaths: string[][];
  };
  /** Number of stored entries (images and fail markers). */
  size(): number;
}

const FAKE_VAULT_ID = "0123456789abcdef";

const toUrl = (blob: Blob, rev: string): string => {
  try {
    return URL.createObjectURL(blob);
  } catch {
    return `blob:fake/${rev}`; // no object-URL support (some test envs)
  }
};

export const createFakeThumbnailStore = (opts: {
  revisionOf: (
    handle: string,
    path: string,
  ) => Promise<string | null> | string | null;
  vaultId?: string;
  /** The first N lookups answer `pending` for every path (cold-manifest test). */
  pendingLookups?: number;
}): FakeThumbnailStore => {
  const vaultId = opts.vaultId ?? FAKE_VAULT_ID;
  const urls = new Map<string, string>(); // rev -> image url
  const fails = new Set<string>(); // `${rev}.v${version}`
  let pending = opts.pendingLookups ?? 0;
  const calls: FakeThumbnailStore["calls"] = {
    lookup: 0,
    put: 0,
    clear: 0,
    lookupPaths: [],
  };

  return {
    calls,
    size: () => urls.size + fails.size,
    async lookup(handle, paths, renderVersion) {
      calls.lookup++;
      calls.lookupPaths.push([...paths]);
      if (pending > 0) {
        pending--;
        return {
          vaultId,
          items: paths.map((): LookupItem => ({ rev: null, state: "pending" })),
        };
      }
      const items = await Promise.all(
        paths.map(async (path): Promise<LookupItem> => {
          const rev = await opts.revisionOf(handle, path);
          if (rev === null) {
            return { rev: null, state: "missing" };
          }
          if (urls.has(rev)) {
            return { rev, state: "hit" };
          }
          return {
            rev,
            state: fails.has(`${rev}.v${renderVersion}`) ? "failed" : "miss",
          };
        }),
      );
      return { vaultId, items };
    },
    async put(_handle, _path, rev, png, renderVersion) {
      calls.put++;
      if (!png) {
        fails.add(`${rev}.v${renderVersion}`);
        return null;
      }
      const old = urls.get(rev);
      if (
        old &&
        old.startsWith("blob:") &&
        typeof URL.revokeObjectURL === "function"
      ) {
        URL.revokeObjectURL(old);
      }
      const url = toUrl(png, rev);
      urls.set(rev, url);
      return url;
    },
    urlFor: (_vaultId, rev) => urls.get(rev) ?? `blob:fake/${rev}`,
    async clear() {
      calls.clear++;
      urls.clear();
      fails.clear();
    },
  };
};
