/**
 * Copies a rendered image to the system clipboard. In the desktop app this is
 * a native command (WKWebView's navigator.clipboard is unreliable); outside
 * Tauri, or when the platform has no native support, it falls back to the web
 * clipboard API.
 */

import { isTauriAvailable, loadTauriInvoke } from "./DesktopVaultRepository";

export type ClipboardKind = "png" | "svg";

const hasCode = (error: unknown, code: string) =>
  !!error &&
  typeof error === "object" &&
  (error as { code?: unknown }).code === code;

export const copyWithWebClipboard = async (
  kind: ClipboardKind,
  bytes: Uint8Array,
  nav: Navigator = navigator,
): Promise<void> => {
  if (kind === "svg") {
    await nav.clipboard.writeText(new TextDecoder().decode(bytes));
    return;
  }
  await nav.clipboard.write([
    new ClipboardItem({
      "image/png": new Blob([bytes as BlobPart], { type: "image/png" }),
    }),
  ]);
};

export const copyToClipboard = async (
  kind: ClipboardKind,
  bytes: Uint8Array,
  win: Window = window,
): Promise<void> => {
  if (isTauriAvailable(win)) {
    try {
      const invoke = await loadTauriInvoke();
      if (!invoke) {
        throw Object.assign(new Error("Tauri is unavailable"), {
          code: "UNSUPPORTED",
        });
      }
      await invoke("copy_to_clipboard", bytes, {
        headers: { "x-clipboard-kind": kind },
      });
      return;
    } catch (error) {
      if (!hasCode(error, "UNSUPPORTED")) {
        throw error;
      }
    }
  }
  await copyWithWebClipboard(kind, bytes, win.navigator);
};
