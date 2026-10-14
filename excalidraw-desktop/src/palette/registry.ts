/**
 * Palette providers registered by features (VaultApp, the open editor, ...).
 * Module-level like the pen selector: one window, one palette. Nothing runs
 * here until the palette opens and calls collectPaletteItems().
 */
import type { PaletteItem, PaletteProvider } from "./types";

const providers = new Map<string, PaletteProvider>();

/** Add (or replace by id) a provider; returns the unregister function. */
export function registerPaletteProvider(provider: PaletteProvider): () => void {
  providers.set(provider.id, provider);
  return () => {
    if (providers.get(provider.id) === provider) {
      providers.delete(provider.id);
    }
  };
}

/**
 * Every provider's entries, in registration order. A provider that throws is
 * skipped (logged), so one broken feature never empties the palette.
 * Duplicate keys keep the first entry.
 */
export function collectPaletteItems(): PaletteItem[] {
  const out: PaletteItem[] = [];
  const seen = new Set<string>();
  for (const provider of providers.values()) {
    let items: readonly PaletteItem[];
    try {
      items = provider.items();
    } catch (err) {
      console.error(`Palette provider "${provider.id}" failed`, err);
      continue;
    }
    for (const item of items) {
      if (!seen.has(item.key)) {
        seen.add(item.key);
        out.push(item);
      }
    }
  }
  return out;
}

/** Test helper: drop every provider. */
export function resetPaletteProviders(): void {
  providers.clear();
}
