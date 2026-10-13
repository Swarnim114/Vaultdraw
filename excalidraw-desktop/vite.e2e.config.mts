import path from "path";

import { defineConfig, mergeConfig } from "vite";

import baseConfig from "./vite.config.mts";

// Production-style bundle of the Playwright harness (e2e.html). Serving
// bundled files is much lighter than the dev server, which sends the editor
// as thousands of unbundled modules on every page load.
export default mergeConfig(
  baseConfig,
  defineConfig({
    build: {
      outDir: path.resolve(__dirname, "../.cache/e2e-dist"),
      emptyOutDir: true,
      sourcemap: false,
      reportCompressedSize: false,
      rollupOptions: {
        input: path.resolve(__dirname, "e2e.html"),
      },
    },
    preview: {
      port: 1421,
      strictPort: true,
    },
  }),
);
