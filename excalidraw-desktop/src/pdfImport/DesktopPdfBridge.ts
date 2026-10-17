import {
  normalizeError,
  resolveInvoke,
  VaultError,
} from "../vault/DesktopVaultRepository";

import type { InvokeFn } from "../vault/DesktopVaultRepository";

import type { PdfBridge, PdfInfo, PdfRenderOptions } from "./types";

export type DesktopPdfBridgeOptions = { invoke?: InvokeFn };

/** Tauri bridge for the native PDF commands (src-tauri pdf_import.rs). Errors carry the NativeError `.code`. */
export class DesktopPdfBridge implements PdfBridge {
  constructor(private readonly options: DesktopPdfBridgeOptions = {}) {}

  private async call<T>(
    cmd: string,
    args?: Record<string, unknown> | Uint8Array,
    headers?: Record<string, string>,
  ): Promise<T> {
    try {
      const invoke = await resolveInvoke(this.options.invoke);
      return await invoke<T>(cmd, args, headers ? { headers } : undefined);
    } catch (err) {
      throw err instanceof VaultError ? err : normalizeError(err);
    }
  }

  pick = (): Promise<PdfInfo | null> => this.call<PdfInfo | null>("pdf_pick");

  openBytes = (name: string, bytes: Uint8Array): Promise<PdfInfo> =>
    this.call<PdfInfo>("pdf_open_bytes", bytes, {
      "x-file-name": encodeURIComponent(name),
    });

  renderPage = async (
    token: number,
    index: number,
    opts: PdfRenderOptions,
  ): Promise<Uint8Array> => {
    const buffer = await this.call<ArrayBuffer>("pdf_render_page", {
      token,
      index,
      maxSide: opts.maxSide,
      format: opts.format,
      quality: opts.quality,
    });
    return new Uint8Array(buffer);
  };

  close = (token: number): Promise<void> =>
    this.call<void>("pdf_close", { token });
}

export const desktopPdfBridge: PdfBridge = new DesktopPdfBridge();
