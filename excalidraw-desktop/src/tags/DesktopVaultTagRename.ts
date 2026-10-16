import { normalizeError, resolveInvoke } from "../vault/DesktopVaultRepository";

import type { InvokeFn } from "../vault/DesktopVaultRepository";
import type { MoveResult } from "../links/types";
import type { TagRenamePlan, VaultTagRename } from "./types";

/** Bridges the renderer to `tags_plan_rename` and `rename_tag`. */
export class DesktopVaultTagRename implements VaultTagRename {
  constructor(private readonly options: { invoke?: InvokeFn } = {}) {}

  private async call<T>(
    command: string,
    args: Record<string, unknown>,
  ): Promise<T> {
    const invoke = await resolveInvoke(this.options.invoke);
    try {
      return await invoke<T>(command, args);
    } catch (err) {
      throw normalizeError(err);
    }
  }

  plan(handle: string, from: string, to: string): Promise<TagRenamePlan> {
    return this.call("tags_plan_rename", { handle, from, to });
  }

  rename(
    handle: string,
    from: string,
    to: string,
    openPath: string | null,
  ): Promise<MoveResult> {
    return this.call("rename_tag", { handle, from, to, openPath });
  }
}
