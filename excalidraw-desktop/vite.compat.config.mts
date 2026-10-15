import path from "path";

import { defineConfig, mergeConfig } from "vite";

import baseConfig from "./vite.config.mts";

// Serves compat/ (a plain Excalidraw editor) for the excalidraw.com
// compatibility check, see compat/run.mjs.
export default mergeConfig(
  baseConfig,
  defineConfig({
    root: path.resolve(__dirname, "compat"),
    publicDir: false,
    server: { port: 1437, strictPort: true, fs: { strict: false } },
  }),
);
