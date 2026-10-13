import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const desktopDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(desktopDir, "..");

const pkg = (sub: string) => path.resolve(repoRoot, sub);

// Standalone Vitest config for the Tauri vault shell (QA scope only).
// Mirrors the alias set in the root vitest.config.mts so desktop tests can
// import @excalidraw/* packages without pulling the web bootstrap, Sentry,
// Firebase, service workers, or PWA plugins.
export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@excalidraw\/common$/,
        replacement: pkg("./packages/common/src/index.ts"),
      },
      {
        find: /^@excalidraw\/common\/(.*?)/,
        replacement: pkg("./packages/common/src/$1"),
      },
      {
        find: /^@excalidraw\/element$/,
        replacement: pkg("./packages/element/src/index.ts"),
      },
      {
        find: /^@excalidraw\/element\/(.*?)/,
        replacement: pkg("./packages/element/src/$1"),
      },
      {
        find: /^@excalidraw\/excalidraw$/,
        replacement: pkg("./packages/excalidraw/index.tsx"),
      },
      {
        find: /^@excalidraw\/excalidraw\/(.*?)/,
        replacement: pkg("./packages/excalidraw/$1"),
      },
      {
        find: /^@excalidraw\/math$/,
        replacement: pkg("./packages/math/src/index.ts"),
      },
      {
        find: /^@excalidraw\/math\/(.*?)/,
        replacement: pkg("./packages/math/src/$1"),
      },
      {
        find: /^@excalidraw\/utils$/,
        replacement: pkg("./packages/utils/src/index.ts"),
      },
      {
        find: /^@excalidraw\/utils\/(.*?)/,
        replacement: pkg("./packages/utils/src/$1"),
      },
      {
        find: /^@excalidraw\/fractional-indexing$/,
        replacement: pkg("./packages/fractional-indexing/src/index.ts"),
      },
      {
        find: /^@excalidraw\/fractional-indexing\/(.*?)/,
        replacement: pkg("./packages/fractional-indexing/src/$1"),
      },
      {
        find: /^@excalidraw\/laser-pointer$/,
        replacement: pkg("./packages/laser-pointer/src/index.ts"),
      },
      {
        find: /^@excalidraw\/laser-pointer\/(.*?)/,
        replacement: pkg("./packages/laser-pointer/src/$1"),
      },
      // Convenience alias for desktop sources under test.
      {
        find: /^@desktop\/(.*?)/,
        replacement: path.resolve(desktopDir, "./src/$1"),
      },
    ],
  },
  test: {
    globals: true,
    environment: "jsdom",
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    hideSkippedTests: true,
    // Lightweight contract/logic tests run WITHOUT the root setupTests.ts
    // (canvas mocks, font mocks, fake-indexeddb) so they stay fast and do
    // not require the full editor dependency chain.
    //
    // Editor integration tests that mount VaultEditor / Excalidraw SHOULD opt
    // into the root setup by adding, per-file:
    //   // @vitest-environment jsdom
    // and running vitest with `--setupFiles ../../setupTests.ts`,
    // or by uncommenting the setupFiles line below once the editor module
    // exists. Keep it commented until lead installs desktop devDeps.
    setupFiles: [path.resolve(repoRoot, "./setupTests.ts")],
    testTimeout: 10_000,
  },
});
