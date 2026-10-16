/**
 * Parsed history versions for the preview: a small LRU, one raw fetch per
 * version shared with the thumbnails, in-flight dedupe, nothing kept after
 * `clear()`.
 */
import { restoreAppState, restoreElements } from "@excalidraw/excalidraw";

import type { OrderedExcalidrawElement } from "@excalidraw/element/types";

import type { AppState, BinaryFiles } from "@excalidraw/excalidraw/types";

import { VaultError } from "../../vault/DesktopVaultRepository";
import { fileLevelAppState } from "../restore";

import { resolveFiles } from "./resolveFiles";

import type { RawFiles } from "./resolveFiles";

import type { HistoryRepository } from "../types";

export interface LoadedVersion {
  id: string;
  fileRevision: string;
  elements: readonly OrderedExcalidrawElement[];
  appState: Partial<AppState>;
  files: BinaryFiles;
  imagesLoaded: boolean;
  elementCount: number;
}

export interface VersionCache {
  load(
    id: string,
    opts: { images: boolean; signal?: AbortSignal },
  ): Promise<LoadedVersion>;
  peek(id: string): LoadedVersion | undefined;
  json(id: string): Promise<string>;
  clear(): void;
}

export interface VersionCacheDeps {
  repository: HistoryRepository;
  handle: string;
  mainFiles: () => BinaryFiles | undefined;
  capacity?: number;
}

interface Raw {
  fileRevision: string;
  json: string;
}
interface Entry {
  version: LoadedVersion;
  rawFiles: RawFiles;
  imageIds: string[];
}

const DEFAULT_CAPACITY = 3;

const aborted = () => new DOMException("Aborted", "AbortError");

/** Rejects early on abort; the shared work itself keeps going for others. */
const withSignal = <T>(work: Promise<T>, signal?: AbortSignal): Promise<T> => {
  if (!signal) {
    return work;
  }
  if (signal.aborted) {
    return Promise.reject(aborted());
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(aborted());
    signal.addEventListener("abort", onAbort, { once: true });
    work
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", onAbort));
  });
};

const parse = (id: string, raw: Raw): Entry => {
  let data: any;
  try {
    data = JSON.parse(raw.json);
  } catch {
    throw new VaultError("VERSION_CORRUPT", "This version cannot be read");
  }
  const elements = restoreElements(data?.elements, null);
  const imageIds = [
    ...new Set(
      elements.flatMap((e) =>
        e.type === "image" && e.fileId ? [e.fileId] : [],
      ),
    ),
  ];
  return {
    version: {
      id,
      fileRevision: raw.fileRevision,
      elements,
      appState: fileLevelAppState(restoreAppState(data?.appState, null)),
      files: {},
      imagesLoaded: false,
      elementCount: elements.filter((e) => !e.isDeleted).length,
    },
    rawFiles: (data?.files ?? {}) as RawFiles,
    imageIds,
  };
};

export const createVersionCache = (deps: VersionCacheDeps): VersionCache => {
  const { repository, handle, mainFiles } = deps;
  const capacity = deps.capacity ?? DEFAULT_CAPACITY;
  // Map order = recency (oldest first).
  const entries = new Map<string, Entry>();
  const rawInflight = new Map<string, Promise<Raw>>();
  const parseInflight = new Map<string, Promise<Entry>>();
  const imageInflight = new Map<string, Promise<LoadedVersion>>();
  let epoch = 0;

  const fetchRaw = (id: string): Promise<Raw> => {
    let p = rawInflight.get(id);
    if (!p) {
      p = repository.readVersion(handle, id).then(({ meta, json }) => ({
        fileRevision: meta.fileRevision,
        json,
      }));
      const drop = () => {
        if (rawInflight.get(id) === p) {
          rawInflight.delete(id);
        }
      };
      p.then(drop, drop);
      rawInflight.set(id, p);
    }
    return p;
  };

  const touch = (id: string, entry: Entry) => {
    entries.delete(id);
    entries.set(id, entry);
    while (entries.size > capacity) {
      entries.delete(entries.keys().next().value as string);
    }
  };

  const entryFor = (id: string): Promise<Entry> => {
    const hit = entries.get(id);
    if (hit) {
      touch(id, hit);
      return Promise.resolve(hit);
    }
    let p = parseInflight.get(id);
    if (!p) {
      const mine = epoch;
      p = fetchRaw(id).then((raw) => {
        const entry = parse(id, raw);
        if (mine === epoch) {
          touch(id, entry);
        }
        return entry;
      });
      const drop = () => {
        if (parseInflight.get(id) === p) {
          parseInflight.delete(id);
        }
      };
      p.then(drop, drop);
      parseInflight.set(id, p);
    }
    return p;
  };

  const withImages = (id: string, entry: Entry): Promise<LoadedVersion> => {
    let p = imageInflight.get(id);
    if (!p) {
      const mine = epoch;
      p = resolveFiles(entry.imageIds, entry.rawFiles, {
        repository,
        handle,
        mainFiles,
      }).then((files) => {
        entry.version = { ...entry.version, files, imagesLoaded: true };
        if (mine === epoch && !entries.has(id)) {
          touch(id, entry);
        }
        return entry.version;
      });
      const drop = () => {
        if (imageInflight.get(id) === p) {
          imageInflight.delete(id);
        }
      };
      p.then(drop, drop);
      imageInflight.set(id, p);
    }
    return p;
  };

  return {
    load: (id, { images, signal }) =>
      signal?.aborted
        ? Promise.reject(aborted())
        : withSignal(
            entryFor(id).then((entry) =>
              images && !entry.version.imagesLoaded
                ? withImages(id, entry)
                : entry.version,
            ),
            signal,
          ),
    peek: (id) => entries.get(id)?.version,
    json: async (id) => (await fetchRaw(id)).json,
    clear: () => {
      epoch += 1;
      entries.clear();
      rawInflight.clear();
      parseInflight.clear();
      imageInflight.clear();
    },
  };
};
