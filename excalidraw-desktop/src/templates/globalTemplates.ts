/**
 * Global templates folder (~/.config/vaultdraw/templates): native commands in
 * the desktop app, an in-memory Map in a plain browser.
 */
import {
  isTauriAvailable,
  VaultError,
  type InvokeFn,
} from "../vault/DesktopVaultRepository";
import { errorMessage } from "../vault/types";

import type { GlobalTemplateInfo, GlobalTemplateStore } from "./types";

export interface GlobalTemplateDeps {
  invoke?: InvokeFn;
  /** Force native mode (tests). Defaults to isTauriAvailable(window). */
  tauri?: boolean;
  /** Backing map for browser mode (injectable for tests/e2e). */
  memory?: Map<string, { json: string; modifiedAt: number }>;
}

const normalizeError = (cause: unknown): Error => {
  if (cause instanceof Error) {
    return cause;
  }
  if (cause && typeof cause === "object") {
    const { code, message } = cause as { code?: unknown; message?: unknown };
    return new VaultError(
      typeof code === "string" ? code : "TEMPLATE_ERROR",
      typeof message === "string" ? message : errorMessage(cause),
    );
  }
  return new Error(errorMessage(cause));
};

const createMemoryStore = (
  files: NonNullable<GlobalTemplateDeps["memory"]>,
): GlobalTemplateStore => ({
  async list() {
    return [...files].map(([name, f]) => ({
      name,
      modifiedAt: f.modifiedAt,
      size: f.json.length,
    }));
  },
  async read(name) {
    const file = files.get(name);
    if (!file) {
      throw new VaultError("NOT_FOUND", `template not found: ${name}`);
    }
    return file.json;
  },
  async write(name, json) {
    if (files.has(name)) {
      throw new VaultError("NAME_COLLISION", `template exists: ${name}`);
    }
    files.set(name, { json, modifiedAt: Date.now() });
  },
  async reveal() {},
});

const createNativeStore = (invokeFn?: InvokeFn): GlobalTemplateStore => {
  const call = async <T>(cmd: string, args?: Record<string, unknown>) => {
    try {
      const invoke =
        invokeFn ?? ((await import("@tauri-apps/api/core")).invoke as InvokeFn);
      return await invoke<T>(cmd, args);
    } catch (err) {
      throw normalizeError(err);
    }
  };
  return {
    list: () => call<GlobalTemplateInfo[]>("list_global_templates"),
    read: async (name) =>
      (
        await call<{ json: string; revision: string }>("read_global_template", {
          name,
        })
      ).json,
    write: (name, json) => call<void>("write_global_template", { name, json }),
    reveal: () => call<void>("open_global_templates_dir"),
  };
};

export function createGlobalTemplateStore(
  deps: GlobalTemplateDeps = {},
): GlobalTemplateStore {
  const native =
    deps.tauri ??
    isTauriAvailable(typeof window === "undefined" ? null : window);
  return native
    ? createNativeStore(deps.invoke)
    : createMemoryStore(deps.memory ?? new Map());
}
