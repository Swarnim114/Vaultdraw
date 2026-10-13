import { defineConfig, devices } from "@playwright/test";

// Drives the real VaultApp UI in a browser (see e2e.html). WebKit matches the
// macOS Tauri WKWebView; Chromium guards against engine-specific fixes.
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  fullyParallel: false,
  reporter: [["list"]],
  outputDir: "../.cache/e2e-results",
  use: {
    baseURL: "http://localhost:1421",
    viewport: { width: 1280, height: 850 },
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npx vite --port 1421 --strictPort",
    url: "http://localhost:1421/e2e.html",
    reuseExistingServer: true,
    timeout: 120_000,
  },
  projects: [
    {
      name: "webkit",
      use: {
        ...devices["Desktop Safari"],
        viewport: { width: 1280, height: 850 },
      },
    },
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 850 },
      },
    },
  ],
});
