import path from "path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Offline desktop frontend for Excalidraw Vault (Tauri 2 WebView shell).
//
// - Dev server is pinned to port 1420 with strictPort: `tauri dev` waits on
//   exactly this port, so it must never silently shift.
// - Build output is `dist` (NOT excalidraw-app's `build`); the native worker
//   wires `frontendDist` to `../dist` in tauri.conf.json.
// - Source aliases mirror the root vitest config and excalidraw-app's Vite
//   config so the real editor source resolves identically in all three.
// - Deliberately NO web-only plugins: no PWA, sitemap, EJS/HTML templating,
//   checker, Sentry, Firebase, or service worker. Cold start is fully local.
// - Fonts, WASM (font subsetting), workers, and locales bundle locally via
//   relative imports. The woff2 CDN-rewriting plugin from scripts/woff2 is
//   intentionally excluded — it injects remote font fallback URLs.
// - `assetsInlineLimit: 0` keeps fonts/WASM as emitted files instead of
//   inlining them, matching excalidraw-app behavior for cacheable assets.
export default defineConfig({
  clearScreen: false,
  define: {
    "import.meta.env.VITE_APP_OFFLINE": JSON.stringify("true"),
    "import.meta.env.VITE_APP_ENABLE_TRACKING": JSON.stringify("false"),
    "import.meta.env.VITE_APP_DISABLE_SENTRY": JSON.stringify("true"),
    "import.meta.env.VITE_APP_SMOKE_TEST": JSON.stringify(
      process.env.VITE_APP_SMOKE_TEST ?? "false",
    ),
    "import.meta.env.VITE_APP_PERF_TEST": JSON.stringify(
      process.env.VITE_APP_PERF_TEST ?? "false",
    ),
  },
  server: {
    port: 1420,
    strictPort: true,
  },
  // Keep web .env files (Sentry keys, tracking flags) out of this build;
  // only excalidraw-desktop/.env is loaded, if present.
  envDir: ".",
  resolve: {
    alias: [
      {
        find: /^@excalidraw\/common$/,
        replacement: path.resolve(__dirname, "../packages/common/src/index.ts"),
      },
      {
        find: /^@excalidraw\/common\/(.*?)/,
        replacement: path.resolve(__dirname, "../packages/common/src/$1"),
      },
      {
        find: /^@excalidraw\/element$/,
        replacement: path.resolve(
          __dirname,
          "../packages/element/src/index.ts",
        ),
      },
      {
        find: /^@excalidraw\/element\/(.*?)/,
        replacement: path.resolve(__dirname, "../packages/element/src/$1"),
      },
      {
        find: /^@excalidraw\/excalidraw$/,
        replacement: path.resolve(
          __dirname,
          "../packages/excalidraw/index.tsx",
        ),
      },
      {
        find: /^@excalidraw\/excalidraw\/(.*?)/,
        replacement: path.resolve(__dirname, "../packages/excalidraw/$1"),
      },
      {
        find: /^@excalidraw\/math$/,
        replacement: path.resolve(__dirname, "../packages/math/src/index.ts"),
      },
      {
        find: /^@excalidraw\/math\/(.*?)/,
        replacement: path.resolve(__dirname, "../packages/math/src/$1"),
      },
      {
        find: /^@excalidraw\/utils$/,
        replacement: path.resolve(__dirname, "../packages/utils/src/index.ts"),
      },
      {
        find: /^@excalidraw\/utils\/(.*?)/,
        replacement: path.resolve(__dirname, "../packages/utils/src/$1"),
      },
      {
        find: /^@excalidraw\/fractional-indexing$/,
        replacement: path.resolve(
          __dirname,
          "../packages/fractional-indexing/src/index.ts",
        ),
      },
      {
        find: /^@excalidraw\/fractional-indexing\/(.*?)/,
        replacement: path.resolve(
          __dirname,
          "../packages/fractional-indexing/src/$1",
        ),
      },
      {
        find: /^@excalidraw\/laser-pointer$/,
        replacement: path.resolve(
          __dirname,
          "../packages/laser-pointer/src/index.ts",
        ),
      },
    ],
  },
  build: {
    outDir: "dist",
    sourcemap: true,
    // Don't auto-inline small assets (fonts/WASM stay as local files).
    assetsInlineLimit: 0,
    rollupOptions: {
      output: {
        assetFileNames(chunkInfo) {
          if (chunkInfo?.name?.endsWith(".woff2")) {
            const family = chunkInfo.name.split("-")[0];
            return `fonts/${family}/[name][extname]`;
          }

          return "assets/[name]-[hash][extname]";
        },
        // Keep locales and heavy optional chunks out of the main bundle;
        // they are still served locally, never from a CDN.
        manualChunks(id) {
          if (
            id.includes("packages/excalidraw/locales") &&
            id.match(/en.json|percentages.json/) === null
          ) {
            const index = id.indexOf("locales/");
            return `locales/${id.substring(index + 8)}`;
          }

          if (id.includes("@excalidraw/mermaid-to-excalidraw")) {
            return "mermaid-to-excalidraw";
          }

          if (id.includes("@codemirror/") || id.includes("@lezer/")) {
            return "codemirror.chunk";
          }
        },
      },
    },
  },
  worker: {
    // Font-subsetting workers ship as local ES module chunks.
    format: "es",
  },
  assetsInclude: ["**/*.wasm"],
  // No static public dir: the shared root public/ holds web artifacts
  // (service-worker.js, web icons) that must never ship in the desktop app.
  // Installer icons live in src-tauri (native worker scope).
  publicDir: false,
  plugins: [react()],
});
