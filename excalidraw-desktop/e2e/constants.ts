/** Autosave idle delay used by the e2e harness (production default: 500ms). */
export const E2E_AUTOSAVE_MS = 100;

/** Long enough for an autosave plus its watcher echo to complete. */
export const AFTER_AUTOSAVE_MS = E2E_AUTOSAVE_MS * 5;
