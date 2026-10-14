import path from "path";

import { defineConfig, mergeConfig } from "vite";

import baseConfig from "../../vite.config.mts";

// Production-style bundle of the Chromium perf harness (perf.html), served by
// perf/lib/browser.mjs together with the fixture vault.
export default mergeConfig(
  baseConfig,
  defineConfig({
    root: path.resolve(__dirname, "../.."),
    build: {
      outDir: path.resolve(__dirname, "../../../.cache/perf/browser-dist"),
      emptyOutDir: true,
      sourcemap: false,
      reportCompressedSize: false,
      rollupOptions: {
        input: path.resolve(__dirname, "perf.html"),
      },
    },
    preview: {
      port: 1422,
      strictPort: true,
    },
  }),
);
