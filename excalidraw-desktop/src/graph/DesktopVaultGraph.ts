import { normalizeError, resolveInvoke } from "../vault/DesktopVaultRepository";

import { decodeGraph } from "./decode";

import type { InvokeFn } from "../vault/DesktopVaultRepository";
import type { GraphData } from "./types";

export interface DesktopVaultGraphOptions {
  invoke?: InvokeFn;
}

/** Tauri hands back an ArrayBuffer for raw responses (an array of numbers in some mocks). */
function toBytes(raw: unknown): Uint8Array {
  if (Array.isArray(raw)) {
    return Uint8Array.from(raw as number[]);
  }
  if (ArrayBuffer.isView(raw)) {
    return new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
  }
  return raw ? new Uint8Array(raw as ArrayBuffer) : new Uint8Array(0);
}

/** Bridges the renderer to `vault_graph` and the layout store commands (raw bodies, no JSON). */
export class DesktopVaultGraph {
  constructor(private readonly options: DesktopVaultGraphOptions = {}) {}

  private async call<T>(
    command: string,
    args?: Record<string, unknown> | Uint8Array,
    headers?: Record<string, string>,
  ): Promise<T> {
    const invoke = await resolveInvoke(this.options.invoke);
    try {
      return await (headers
        ? invoke<T>(command, args, { headers })
        : invoke<T>(command, args));
    } catch (err) {
      throw normalizeError(err);
    }
  }

  /** The whole vault graph (one IPC call; every toggle afterwards is a client-side mask). */
  async graph(handle: string): Promise<GraphData> {
    return decodeGraph(
      toBytes(await this.call<ArrayBuffer>("vault_graph", { handle })),
    );
  }

  /** Saved layout bytes, empty when none (format: layoutStore.ts). */
  async loadLayout(handle: string): Promise<Uint8Array> {
    return toBytes(
      await this.call<ArrayBuffer>("graph_layout_load", { handle }),
    );
  }

  /** Saves layout bytes as a raw body; the vault handle travels in a header. An empty array clears. */
  async saveLayout(handle: string, bytes: Uint8Array): Promise<void> {
    await this.call<void>("graph_layout_save", bytes, { handle });
  }
}
