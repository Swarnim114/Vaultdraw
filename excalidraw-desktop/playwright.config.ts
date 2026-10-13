import { defineConfig, devices } from "@playwright/test";

// Drives the real VaultApp UI in a browser (see e2e.html). WebKit matches the
// macOS Tauri WKWebView; Chromium guards against engine-specific fixes.
//
// `yarn test:e2e` runs WebKit only with 2 workers to keep laptops cool.
// `yarn test:e2e:full` (E2E_FULL=1) adds Chromium, screenshots and the
// screenshot gallery spec.
const full = process.env.E2E_FULL === "1";

const viewport = { width: 1280, height: 850 };

export default defineConfig({
  testDir: "./e2e",
  testIgnore: full ? [] : ["gallery.spec.ts"],
  timeout: 60_000,
  fullyParallel: false,
  workers: Number(process.env.E2E_WORKERS) || 2,
  reporter: [["list"]],
  outputDir: "../.cache/e2e-results",
  use: {
    baseURL: "http://localhost:1421",
    viewport,
    trace: "retain-on-failure",
  },
  webServer: {
    command:
      "npx vite build --config vite.e2e.config.mts --logLevel warn && npx vite preview --config vite.e2e.config.mts",
    url: "http://localhost:1421/e2e.html",
    reuseExistingServer: false,
    timeout: 180_000,
  },
  projects: [
    {
      name: "webkit",
      use: { ...devices["Desktop Safari"], viewport },
    },
    ...(full
      ? [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport } }]
      : []),
  ],
});
