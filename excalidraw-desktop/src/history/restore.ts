/**
 * File history restore (PLAN-H2 §3/§4): replace the live scene with a version
 * (undoable), copy a selection out of a version, restore as a file copy.
 * Pure helpers plus thin wrappers around the editor API and the repository.
 */
import { randomInteger } from "@excalidraw/common";
import { duplicateElements } from "@excalidraw/element";
import { CaptureUpdateAction } from "@excalidraw/excalidraw";

import type {
  ExcalidrawElement,
  OrderedExcalidrawElement,
} from "@excalidraw/element/types";
import type {
  AppState,
  BinaryFileData,
  BinaryFiles,
  ExcalidrawImperativeAPI,
} from "@excalidraw/excalidraw/types";

import { VaultError } from "../vault/DesktopVaultRepository";

import type { SaveStatus } from "../vault/types";

import type { LoadedVersion } from "./preview/versionCache";
import type { HistoryRepository } from "./types";

export type ReplaceRefusal = "conflict" | "deleted" | "read-only" | null;

export interface RestoreState {
  status: SaveStatus;
  deleted: boolean;
  readOnly: boolean;
}

export const REFUSAL_TEXT: Record<Exclude<ReplaceRefusal, null>, string> = {
  conflict: "The drawing has unsaved conflicting changes",
  deleted: "The drawing was deleted",
  "read-only": "This vault is read-only",
};

export const replaceRefusal = (s: RestoreState): ReplaceRefusal => {
  if (s.readOnly) {
    return "read-only";
  }
  if (s.deleted) {
    return "deleted";
  }
  return s.status === "conflict" ? "conflict" : null;
};

/** Never scroll, zoom, selection or tools: only what belongs to the file. */
const FILE_LEVEL_KEYS = [
  "viewBackgroundColor",
  "viewBackgroundPattern",
  "pageSetup",
] as const;

export const fileLevelAppState = (
  appState: Partial<AppState>,
): Partial<AppState> => {
  const out: Record<string, unknown> = {};
  for (const key of FILE_LEVEL_KEYS) {
    if (appState[key] !== undefined) {
      out[key] = appState[key];
    }
  }
  return out as Partial<AppState>;
};

/** Newer than `base` in every way the editor's reconciliation looks at. */
const bump = <T extends ExcalidrawElement>(
  element: T,
  baseVersion: number,
  patch: Partial<ExcalidrawElement> = {},
): T => ({
  ...element,
  ...patch,
  version: Math.max(baseVersion, element.version) + 1,
  versionNonce: randomInteger(),
  updated: Date.now(),
});

export const buildReplaceElements = (
  current: readonly ExcalidrawElement[],
  version: readonly ExcalidrawElement[],
): ExcalidrawElement[] => {
  const currentById = new Map(current.map((e) => [e.id, e]));
  const inVersion = new Set<string>();
  const out: ExcalidrawElement[] = [];
  for (const v of version) {
    inVersion.add(v.id);
    out.push(bump(v, currentById.get(v.id)?.version ?? 0));
  }
  // Kept as deleted (not dropped) so undo can bring them back.
  for (const c of current) {
    if (!inVersion.has(c.id)) {
      out.push(c.isDeleted ? c : bump(c, c.version, { isDeleted: true }));
    }
  }
  return out;
};

/** Files the main editor does not have yet. */
const missingFiles = (
  have: BinaryFiles,
  files: BinaryFiles,
  ids?: ReadonlySet<string>,
): BinaryFileData[] =>
  Object.values(files).filter((f) => !have[f.id] && (!ids || ids.has(f.id)));

export interface RestoreReplaceDeps {
  repository: HistoryRepository;
  handle: string;
  path: string;
  flush: () => Promise<void>;
  api: ExcalidrawImperativeAPI;
  state: () => RestoreState;
}

const refuse = (reason: Exclude<ReplaceRefusal, null>): never => {
  throw new VaultError("RESTORE_REFUSED", REFUSAL_TEXT[reason]);
};

/**
 * Throws on refusal or when the safety snapshot fails (nothing is touched
 * then). The version should come from `load(id, { images: true })`.
 */
export const restoreReplace = async (
  deps: RestoreReplaceDeps,
  version: LoadedVersion,
): Promise<void> => {
  const { repository, handle, path, flush, api, state } = deps;
  const before = replaceRefusal(state());
  if (before) {
    refuse(before);
  }
  await flush();
  // A conflict can surface while the flush runs.
  const after = replaceRefusal(state());
  if (after) {
    refuse(after);
  }
  await repository.snapshot(handle, path, "before-restore", true);

  const elements = buildReplaceElements(
    api.getSceneElementsIncludingDeleted(),
    version.elements,
  );
  const files = missingFiles(api.getFiles(), version.files);
  if (files.length) {
    api.addFiles(files);
  }
  api.updateScene({
    elements,
    appState: fileLevelAppState(version.appState) as AppState,
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });
};

/** Selected ids plus the text bound to selected containers. */
const selectedWithBoundText = (
  selected: readonly OrderedExcalidrawElement[],
  all: ReadonlyMap<string, OrderedExcalidrawElement>,
): OrderedExcalidrawElement[] => {
  const ids = new Set(selected.map((e) => e.id));
  for (const e of selected) {
    for (const b of e.boundElements ?? []) {
      if (b.type === "text" && all.has(b.id)) {
        ids.add(b.id);
      }
    }
  }
  return [...ids].map((id) => all.get(id)!);
};

/** Makes a set self-contained: no references to elements outside it. */
const isolate = <T extends ExcalidrawElement>(set: readonly T[]): T[] => {
  const ids = new Set(set.map((e) => e.id));
  const keep = (id: string | null | undefined) =>
    id && ids.has(id) ? id : null;
  return set.map((e) => {
    const next: Record<string, unknown> = { ...e };
    if ("containerId" in e) {
      next.containerId = keep(e.containerId);
    }
    if ("startBinding" in e || "endBinding" in e) {
      const b = (binding: { elementId: string } | null | undefined) =>
        binding && ids.has(binding.elementId) ? binding : null;
      next.startBinding = b((e as any).startBinding);
      next.endBinding = b((e as any).endBinding);
    }
    next.frameId = keep(e.frameId);
    if (e.boundElements) {
      next.boundElements = e.boundElements.filter((b) => ids.has(b.id));
    }
    return next as unknown as T;
  });
};

const DUPLICATE_OFFSET = 10;

/**
 * Ids missing or deleted in `main` come back under their own id (newer than
 * what main has); ids that are live there are duplicated with new ids so
 * nothing is overwritten. Returns how many elements were added.
 */
export const copySelectionInto = (
  main: ExcalidrawImperativeAPI,
  preview: ExcalidrawImperativeAPI,
  version: LoadedVersion,
): number => {
  const selectedIds = preview.getAppState().selectedElementIds;
  const byId = new Map(version.elements.map((e) => [e.id, e] as const));
  const picked = version.elements.filter(
    (e) => selectedIds[e.id] && !e.isDeleted,
  );
  if (picked.length === 0) {
    return 0;
  }
  const chosen = selectedWithBoundText(picked, byId).filter(
    (e) => !e.isDeleted,
  );

  const current = main.getSceneElementsIncludingDeleted();
  const currentById = new Map(current.map((e) => [e.id, e]));
  const isLive = (id: string) => currentById.get(id)?.isDeleted === false;
  const restored = isolate(chosen.filter((e) => !isLive(e.id))).map((e) =>
    bump(e, currentById.get(e.id)?.version ?? 0),
  );
  const toDuplicate = isolate(chosen.filter((e) => isLive(e.id)));
  const duplicates = toDuplicate.length
    ? duplicateElements({
        type: "everything",
        elements: toDuplicate,
        randomizeSeed: true,
        overrides: ({ origElement }) => ({
          x: origElement.x + DUPLICATE_OFFSET,
          y: origElement.y + DUPLICATE_OFFSET,
        }),
      }).duplicatedElements
    : [];

  const restoredById = new Map(restored.map((e) => [e.id, e]));
  const next: ExcalidrawElement[] = current.map(
    (e) => restoredById.get(e.id) ?? e,
  );
  for (const e of restored) {
    if (!currentById.has(e.id)) {
      next.push(e);
    }
  }
  next.push(...duplicates);

  const added = [...restored, ...duplicates];
  const imageIds = new Set<string>();
  for (const e of added) {
    if (e.type === "image" && e.fileId) {
      imageIds.add(e.fileId);
    }
  }
  const files = missingFiles(main.getFiles(), version.files, imageIds);
  if (files.length) {
    main.addFiles(files);
  }
  main.updateScene({
    elements: next,
    appState: {
      selectedElementIds: Object.fromEntries(added.map((e) => [e.id, true])),
    } as Partial<AppState> as AppState,
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });
  return added.length;
};

export const restoreCopy = (
  repository: HistoryRepository,
  handle: string,
  id: string,
): Promise<{ path: string; revision: string }> =>
  repository.restoreCopy(handle, id);

export const exportVersionFile = (
  repository: HistoryRepository,
  handle: string,
  id: string,
): Promise<boolean> => repository.exportFile(handle, id);
