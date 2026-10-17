import { rmSync } from "node:fs";
import path from "node:path";

import type { FullConfig } from "@playwright/test";

// Auto-picked ports change every run: drop that run's bundle so .cache doesn't
// fill up with e2e-dist-<port> folders. Pinned ports (E2E_PORT) keep theirs.
export default function teardown(config: FullConfig) {
  if (process.env.E2E_PORT_AUTO === "1" && config.configFile) {
    const desktop = path.dirname(config.configFile);
    rmSync(
      path.resolve(desktop, `../.cache/e2e-dist-${process.env.E2E_PORT}`),
      {
        recursive: true,
        force: true,
      },
    );
  }
}
