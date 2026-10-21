import { it } from "vitest";

import {
  DEFAULT_PREFERENCES,
  attachPreferencesStore,
  detachPreferencesStore,
  getPreferences,
} from "../vault/preferences";

// Informational micro-bench (no assertions on time): run with
// PREFS_BENCH=1 npx vitest run src/tests/preferencesBench.test.ts
it.skipIf(!process.env.PREFS_BENCH)("getPreferences per-call cost", () => {
  attachPreferencesStore(DEFAULT_PREFERENCES, () => {});
  const N = 10_000;
  const t0 = performance.now();
  for (let i = 0; i < N; i++) {
    getPreferences();
  }
  const ms = performance.now() - t0;
  // eslint-disable-next-line no-console
  console.log(`memory store: ${((ms / N) * 1000).toFixed(3)} us/call`);
  detachPreferencesStore();
});
