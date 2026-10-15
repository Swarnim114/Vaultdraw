/**
 * Test-only in-memory HistoryRepository (never a production fallback).
 *
 * Mirrors the Rust trigger rules that matter for tests: the shrink rule
 * (before-clear), checkpoint, leave on `opened`, before-restore. It sees the
 * vault's committed writes through `noteCommitted` (the harness wires it to the
 * fake vault repository), so an autosave costs no history IPC. `calls` logs
 * every IPC-like method, which is what the "zero history IPC during autosave"
 * assertions read.
 */
import { VaultError } from "../vault/DesktopVaultRepository";

import type {
  HistoryChange,
  HistoryListing,
  HistoryReason,
  HistoryRepository,
  HistorySettings,
  HistoryStatus,
  SnapshotOutcome,
  VersionInfo,
} from "../history/types";

export const FAKE_DEVICE = "fakedev1";
const SHRINK_MIN_BYTES = 4096;

interface Stored {
  info: VersionInfo;
  path: string;
  json: string;
}

export interface FakeHistoryOptions {
  readOnly?: boolean;
  /** Reads the live file (checkpoint, restore). */
  source?: (handle: string, path: string) => Promise<string | null>;
  /** Creates a new file (restore as copy); returns its revision. */
  createCopy?: (path: string, json: string) => Promise<{ revision: string }>;
}

const fnv = (text: string): string => {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0").repeat(8);
};

/**
 * Size of the live content. A cleared canvas keeps its elements as `isDeleted`
 * tombstones in the saved file, so the raw file barely shrinks; the shrink rule
 * must compare live content (the Rust worker has to do the same).
 */
const liveSize = (json: string): number => {
  try {
    const parsed = JSON.parse(json) as {
      elements?: Array<{ isDeleted?: boolean }>;
    };
    if (!Array.isArray(parsed.elements)) {
      return json.length;
    }
    const live = parsed.elements.filter((e) => !e.isDeleted);
    return (
      json.length -
      JSON.stringify(parsed.elements).length +
      JSON.stringify(live).length
    );
  } catch {
    return json.length;
  }
};

const countElements = (json: string): number | null => {
  try {
    const parsed = JSON.parse(json) as { elements?: unknown[] };
    return Array.isArray(parsed.elements) ? parsed.elements.length : null;
  } catch {
    return null;
  }
};

const error = (code: string, message: string) => new VaultError(code, message);

export class FakeHistoryRepository implements HistoryRepository {
  /** IPC-like methods called so far (not `noteCommitted`, not `subscribe`). */
  calls: string[] = [];
  settings: HistorySettings | null = null;
  openedLog: Array<{ path: string | null; revision: string | null }> = [];
  readOnly: boolean;
  private versions: Stored[] = [];
  private blobs = new Map<string, Uint8Array>();
  private committed = new Map<string, string>(); // path -> latest committed json
  private dirty = new Set<string>(); // paths whose committed state is unversioned
  private openPath: string | null = null;
  private counter = 0;
  private lastTime = 0;
  private listeners = new Set<(event: HistoryChange) => void>();

  constructor(
    private readonly handle = "fake-handle-1",
    private readonly options: FakeHistoryOptions = {},
  ) {
    this.readOnly = options.readOnly ?? false;
  }

  // -- test hooks -----------------------------------------------------------

  /** The vault committed a write (the harness calls this after writeDrawing). */
  noteCommitted(handle: string, path: string, json: string): void {
    if (!this.active(handle) || this.readOnly) {
      return;
    }
    const previous = this.committed.get(path);
    if (
      previous !== undefined &&
      liveSize(previous) >= SHRINK_MIN_BYTES &&
      liveSize(json) <= liveSize(previous) / 2
    ) {
      this.store(path, previous, "before-clear");
    }
    this.committed.set(path, json);
    this.dirty.add(path);
  }

  /** Add a version as if another device (or an older run) had written it. */
  inject(
    path: string,
    json: string,
    partial: Partial<VersionInfo> = {},
  ): VersionInfo {
    return this.store(path, json, partial.reason ?? "auto", partial);
  }

  putBlob(blob: string, bytes: Uint8Array): void {
    this.blobs.set(blob, bytes);
  }

  allVersions(path?: string): VersionInfo[] {
    return this.versions
      .filter((v) => path === undefined || v.path === path)
      .map((v) => v.info);
  }

  /** Test-only: simulate a change event (sync brought files in). */
  emit(paths: string[]): void {
    this.notify(paths);
  }

  // -- internals ------------------------------------------------------------

  private active(handle: string): boolean {
    return (
      handle === this.handle && this.settings !== null && this.settings.enabled
    );
  }

  private nextTime(): number {
    this.lastTime = Math.max(Date.now(), this.lastTime + 1);
    return this.lastTime;
  }

  private store(
    path: string,
    json: string,
    reason: HistoryReason,
    partial: Partial<VersionInfo> = {},
  ): VersionInfo {
    this.counter += 1;
    const info: VersionInfo = {
      id: `fake-v${String(this.counter).padStart(6, "0")}`,
      lineage: `lineage-${path}`,
      createdAt: this.nextTime(),
      device: FAKE_DEVICE,
      ownDevice: true,
      reason,
      name: null,
      note: null,
      kind: "keyframe",
      sizeBytes: json.length,
      elementCount: countElements(json),
      availability: "local",
      headerLoaded: true,
      ...partial,
    };
    this.versions.push({ info, path, json });
    this.dirty.delete(path);
    this.notify([path]);
    return info;
  }

  private notify(paths: string[]): void {
    const event = { handle: this.handle, paths };
    for (const listener of [...this.listeners]) {
      listener(event);
    }
  }

  private requireWritable(): void {
    if (!this.settings || !this.settings.enabled) {
      throw error("HISTORY_OFF", "History is off");
    }
    if (this.readOnly) {
      throw error("HISTORY_READ_ONLY", "History is read-only in this vault");
    }
  }

  private find(id: string): Stored {
    const found = this.versions.find((v) => v.info.id === id);
    if (!found) {
      throw error("VERSION_GONE", "That version no longer exists");
    }
    return found;
  }

  // -- HistoryRepository ----------------------------------------------------

  async configure(_handle: string, settings: HistorySettings): Promise<void> {
    this.calls.push("configure");
    this.settings = { ...settings };
  }

  async status(handle: string): Promise<HistoryStatus> {
    this.calls.push("status");
    const total = this.versions.reduce((n, v) => n + v.info.sizeBytes, 0);
    const checkpoints = this.versions
      .filter((v) => v.info.reason === "checkpoint")
      .reduce((n, v) => n + v.info.sizeBytes, 0);
    return {
      handle,
      state: !this.settings?.enabled
        ? "off"
        : this.readOnly
        ? "read-only"
        : "idle",
      totalBytes: total,
      capBytes: (this.settings?.sizeCapMb ?? 0) * 1024 * 1024,
      checkpointBytes: checkpoints,
      overCap: "none",
      staging: true,
      gcBlocked: false,
      formatNewer: false,
      gitRepo: false,
      lastError: null,
    };
  }

  async opened(
    handle: string,
    path: string | null,
    revision: string | null,
  ): Promise<void> {
    this.calls.push("opened");
    this.openedLog.push({ path, revision });
    const previous = this.openPath;
    this.openPath = path;
    if (
      previous &&
      previous !== path &&
      this.active(handle) &&
      !this.readOnly &&
      this.dirty.has(previous)
    ) {
      this.store(previous, this.committed.get(previous)!, "leave");
    }
  }

  async list(handle: string, path: string): Promise<HistoryListing> {
    this.calls.push("list");
    const versions = this.versions
      .filter((v) => v.path === path)
      .map((v) => v.info)
      .sort((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? 1 : -1));
    return {
      path,
      lineages: versions.length ? [versions[0].lineage] : [],
      versions,
      lastVersionAt: versions[0]?.createdAt ?? null,
      enabled: handle === this.handle && !!this.settings?.enabled,
      readOnly: this.readOnly,
      formatNewer: false,
    };
  }

  async snapshot(
    _handle: string,
    path: string,
    reason: "leave" | "before-restore",
    _wait: boolean,
  ): Promise<SnapshotOutcome> {
    this.calls.push("snapshot");
    if (!this.settings?.enabled) {
      return { id: null, skipped: "off" };
    }
    if (this.readOnly) {
      return { id: null, skipped: "read-only" };
    }
    if (!this.dirty.has(path)) {
      return { id: null, skipped: "clean" };
    }
    const info = this.store(path, this.committed.get(path)!, reason);
    return { id: info.id, skipped: null };
  }

  async snapshotBytes(
    _handle: string,
    path: string,
    reason: "before-outside-change" | "discarded-edits",
    _revision: string,
    json: string,
  ): Promise<SnapshotOutcome> {
    this.calls.push("snapshotBytes");
    if (!this.settings?.enabled) {
      return { id: null, skipped: "off" };
    }
    if (this.readOnly) {
      return { id: null, skipped: "read-only" };
    }
    const latest = [...this.versions].reverse().find((v) => v.path === path);
    if (latest?.json === json) {
      return { id: null, skipped: "already-versioned" };
    }
    const info = this.store(path, json, reason);
    return { id: info.id, skipped: null };
  }

  async checkpoint(
    handle: string,
    path: string,
    name: string,
    note: string,
  ): Promise<VersionInfo> {
    this.calls.push("checkpoint");
    this.requireWritable();
    const trimmed = name.trim();
    if (!trimmed || trimmed.length > 120 || note.length > 2000) {
      throw error("INVALID_ARGUMENT", "Invalid checkpoint name or note");
    }
    const json =
      (await this.options.source?.(handle, path)) ??
      this.committed.get(path) ??
      null;
    if (json === null) {
      throw error("VERSION_GONE", "Nothing to checkpoint");
    }
    return this.store(path, json, "checkpoint", {
      name: trimmed,
      note: note || null,
    });
  }

  async readVersion(_handle: string, id: string) {
    this.calls.push("readVersion");
    const found = this.find(id);
    return {
      meta: { id, fileRevision: fnv(found.json), exact: true },
      json: found.json,
    };
  }

  async readBlob(_handle: string, blob: string): Promise<Uint8Array> {
    this.calls.push("readBlob");
    const bytes = this.blobs.get(blob);
    if (!bytes) {
      throw error("VERSION_GONE", "That image is no longer in history");
    }
    return bytes;
  }

  async restoreCopy(_handle: string, id: string) {
    this.calls.push("restoreCopy");
    const found = this.find(id);
    const base = found.path.replace(/\.excalidraw$/i, "");
    const path = `${base} (restored ${id}).excalidraw`;
    if (this.options.createCopy) {
      const { revision } = await this.options.createCopy(path, found.json);
      return { path, revision };
    }
    return { path, revision: fnv(found.json) };
  }

  async exportFile(_handle: string, id: string): Promise<boolean> {
    this.calls.push("exportFile");
    this.find(id);
    return true;
  }

  async deleteCheckpoint(_handle: string, id: string): Promise<void> {
    this.calls.push("deleteCheckpoint");
    this.requireWritable();
    const found = this.find(id);
    if (found.info.reason !== "checkpoint") {
      throw error("INVALID_ARGUMENT", "Only checkpoints can be deleted");
    }
    this.versions = this.versions.filter((v) => v !== found);
    this.notify([found.path]);
  }

  async deleteAll(_handle: string, path: string): Promise<void> {
    this.calls.push("deleteAll");
    this.requireWritable();
    this.versions = this.versions.filter((v) => v.path !== path);
    this.dirty.delete(path);
    this.notify([path]);
  }

  async excludeFromGit(_handle: string): Promise<void> {
    this.calls.push("excludeFromGit");
  }

  async subscribe(cb: (event: HistoryChange) => void) {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }
}
