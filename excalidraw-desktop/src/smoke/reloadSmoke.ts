/**
 * Packaged smoke: a real webview reload must leave the vault writable
 * (toimprove #39/#45). WKWebView's "Reload" restarts the frontend inside the
 * same Rust process; the Rust side has to release the previous page's vault
 * handles (`on_page_load(Started)` -> `release_all_handles`), otherwise the
 * reopened vault finds its own flock held and comes back read-only.
 *
 * `location.reload()` restarts the JS runner, so the step is resumable:
 *  1. At the end of the run (all other steps passed) `requestReload` flushes
 *     the records so far to the native report (the Rust report lives in the
 *     process and survives the reload), stores a marker in sessionStorage and
 *     reloads.
 *  2. On startup the runner calls `takeReloadMarker`; a fresh marker means
 *     "resume": it reopens the vault through the normal onboarding path and
 *     runs `reloadResumeStep`, then writes the final report. The marker is
 *     removed as soon as it is read, so it can never loop, and it expires, so
 *     a stale one from an older run is ignored.
 */
import { desktopRepository } from "../vault/DesktopVaultRepository";

import type { VaultInfo } from "../vault/types";

export const RELOAD_MARKER_KEY = "vaultdraw-smoke-reload-v1";
export const RELOAD_MARKER_TTL_MS = 120_000;
export const RELOAD_STEP = "page-reload-keeps-vault-writable";

export type ReloadMarker = { v: 1; at: number; stepsBefore: number };

export const encodeReloadMarker = (now: number, stepsBefore: number): string =>
  JSON.stringify({ v: 1, at: now, stepsBefore } as ReloadMarker);

/** Returns the marker when `raw` is a well-formed, unexpired one. */
export const parseReloadMarker = (
  raw: string | null,
  now: number,
  ttlMs = RELOAD_MARKER_TTL_MS,
): ReloadMarker | null => {
  if (!raw) {
    return null;
  }
  try {
    const value = JSON.parse(raw) as Partial<ReloadMarker> | null;
    if (
      value?.v !== 1 ||
      typeof value.at !== "number" ||
      typeof value.stepsBefore !== "number"
    ) {
      return null;
    }
    const age = now - value.at;
    return age >= 0 && age <= ttlMs ? (value as ReloadMarker) : null;
  } catch {
    return null;
  }
};

/** Reads and removes the marker (one-shot); null on a normal launch. */
export const takeReloadMarker = (
  storage: Pick<Storage, "getItem" | "removeItem">,
  now: number,
): ReloadMarker | null => {
  try {
    const raw = storage.getItem(RELOAD_MARKER_KEY);
    storage.removeItem(RELOAD_MARKER_KEY);
    return parseReloadMarker(raw, now);
  } catch {
    return null;
  }
};

/** Why the reopened vault is not usable; empty when it is writable. */
export const writableProblems = (
  info: Pick<VaultInfo, "readOnly" | "readOnlyReason"> | null,
): string[] => {
  if (!info) {
    return ["no vault was opened after the reload"];
  }
  const problems: string[] = [];
  if (info.readOnly) {
    problems.push("VaultInfo.readOnly is true");
  }
  if (info.readOnlyReason) {
    problems.push(`readOnlyReason is ${info.readOnlyReason}`);
  }
  return problems;
};

type SmokeRecord = { step: string; ok: boolean; details?: unknown };

/** Flushes the finished records, stores the marker, reloads. Never resolves. */
export const requestReload = (ctx: {
  win: Window;
  records: SmokeRecord[];
  log: (record: SmokeRecord) => Promise<unknown>;
}): Promise<never> =>
  (async () => {
    for (const record of ctx.records) {
      await ctx.log(record);
    }
    ctx.win.sessionStorage.setItem(
      RELOAD_MARKER_KEY,
      encodeReloadMarker(Date.now(), ctx.records.length),
    );
    ctx.win.location.reload();
    return new Promise<never>(() => {});
  })();

export type ReloadResumeContext = {
  win: Window;
  root: HTMLElement;
  vaultPath: string;
  waitFor: <T>(
    label: string,
    read: () => T | null | undefined,
    ms?: number,
  ) => Promise<T>;
  clickOpenVault: () => void;
  call: (command: string, args?: Record<string, unknown>) => Promise<any>;
};

/**
 * After the reload: reopen the smoke vault through the onboarding button (the
 * same choose_vault path as a normal start), assert it is writable, and that
 * a save really lands on disk.
 */
export const reloadResumeStep = async (ctx: ReloadResumeContext) => {
  await ctx.waitFor("onboarding after reload", () =>
    ctx.root.querySelector(".vault-onboarding"),
  );
  const original = desktopRepository.chooseVault;
  let opened: Promise<VaultInfo | null> | null = null;
  desktopRepository.chooseVault = (create?: boolean) => {
    opened = original.call(desktopRepository, create);
    return opened;
  };
  let info: VaultInfo | null;
  try {
    ctx.clickOpenVault();
    info = await await ctx.waitFor("choose_vault after reload", () => opened);
  } finally {
    desktopRepository.chooseVault = original;
  }
  const problems = writableProblems(info);
  if (info && info.path !== ctx.vaultPath) {
    problems.push(`opened ${info.path}, expected ${ctx.vaultPath}`);
  }
  if (problems.length) {
    throw new Error(`Vault not writable after reload: ${problems.join("; ")}`);
  }
  await ctx.waitFor("vault shell after reload", () =>
    ctx.root.querySelector("[data-vault-path]"),
  );
  const badge = Array.from(ctx.root.querySelectorAll("button")).find((b) =>
    /Read-Only/.test(b.textContent ?? ""),
  );
  if (badge) {
    throw new Error("Read-Only badge is shown after the reload");
  }
  const handle = info!.handle;
  const path = `smoke-after-reload-${Date.now().toString(36)}.excalidraw`;
  const json = JSON.stringify({
    type: "excalidraw",
    version: 2,
    source: "desktop-smoke-reload",
    elements: [],
    appState: {},
    files: {},
  });
  await ctx.call("write_drawing", {
    handle,
    path,
    json,
    expectedRevision: null,
    operationId: `smoke-reload-${Date.now().toString(36)}`,
  });
  const back = await ctx.call("read_drawing", { handle, path });
  const listed = (await ctx.call("list_directory", { handle, path: "" })) as {
    path: string;
  }[];
  if (back.json !== json || !listed.some((entry) => entry.path === path)) {
    throw new Error("Save after reload did not land on disk");
  }
  return { readOnly: info!.readOnly, savedPath: path, bytes: json.length };
};
