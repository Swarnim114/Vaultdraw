// Maps changed files to the Playwright specs that cover them (test impact analysis, KISS).
// Playwright's own --only-changed follows spec imports only; the app under test is served by
// Vite, so app source changes need this path -> spec map.
import { readdirSync } from "node:fs";

// Specs that exercise the shell end to end; run when a shared file changes.
export const CORE_SPECS = ["crud", "edge", "navigator", "commandPalette", "text"];

// Files whose change can affect any spec: run the core set (merge tier runs everything).
const SHARED = [
  /^excalidraw-desktop\/src\/(VaultApp\.tsx|main\.tsx|desktop\.css)$/,
  /^excalidraw-desktop\/src\/components\/VaultShell\.css$/,
  /^excalidraw-desktop\/(e2e\.html|vite(\.e2e)?\.config\.mts|playwright\.config\.ts|package\.json)$/,
  /^excalidraw-desktop\/e2e\/(helpers|constants|pageHelpers|harnessMain)\.tsx?$/,
  /^packages\//,
];

// Source areas whose spec names don't start with the folder name.
const ALIASES = {
  commands: ["commandPalette", "hotkeys", "menuHotkeys", "quickSwitcher"],
  palette: ["commandPalette", "quickSwitcher"],
  tree: ["navigator", "treeWindow", "crud", "dragdrop"],
  settings: ["settingsPhase2", "themes", "hotkeys"],
  theme: ["themes"],
  paper: ["paper"],
  page: ["pageMode"],
  export: ["export", "explorerExport", "pdfExport"],
  toolDefaults: ["toolDefaults", "textDefaults", "text"],
  vault: CORE_SPECS.concat(["filedrop", "dragdrop"]),
  editor: ["crud", "text", "edge"],
  VaultNavigator: ["navigator", "treeWindow"],
  VaultHeader: CORE_SPECS,
  smoke: [],
  perf: [],
  tests: [],
};

const lower = (s) => s.toLowerCase();

/** specNames: spec basenames without ".spec.ts". Returns { specs: string[], reasons: Record<spec, file> }. */
export function impactedSpecs(changedFiles, specNames) {
  const byPrefix = (prefix) => specNames.filter((s) => lower(s).startsWith(lower(prefix)));
  const out = new Map();
  const add = (names, why) => names.forEach((n) => specNames.includes(n) && !out.has(n) && out.set(n, why));
  for (const f of changedFiles) {
    if (SHARED.some((re) => re.test(f))) {
      add(CORE_SPECS, f);
      continue;
    }
    const spec = f.match(/^excalidraw-desktop\/e2e\/([^/]+)\.spec\.ts$/);
    if (spec) {
      add([spec[1]], f);
      continue;
    }
    // e2e/<area>Helpers.ts, e2e/<area>Harness.tsx, e2e/fake<Area>.ts
    const helper = f.match(/^excalidraw-desktop\/e2e\/(?:fake)?([a-zA-Z]+?)(?:Helpers|Harness|Fixtures)?\.tsx?$/);
    if (helper) {
      add(byPrefix(helper[1]), f);
      continue;
    }
    const src = f.match(/^excalidraw-desktop\/src\/(.+)$/);
    if (!src || /\.(test|bench\.test)\.tsx?$/.test(f)) continue;
    // Every folder (and the file name) on the path is a keyword: src/components/tags/TagRow.tsx -> tags.
    const parts = src[1].replace(/\.[^.]+$/, "").split("/");
    const before = out.size;
    let known = false;
    for (const p of parts) {
      known ||= p in ALIASES;
      add(ALIASES[p] ?? byPrefix(p).filter(() => p.length >= 4), f);
    }
    // Unmapped app source: fall back to the core set rather than running nothing.
    if (out.size === before && !known) add(CORE_SPECS, `${f} (unmapped)`);
  }
  return { specs: [...out.keys()].sort(), reasons: Object.fromEntries(out) };
}

export function listSpecNames(e2eDir) {
  return readdirSync(e2eDir).filter((f) => f.endsWith(".spec.ts")).map((f) => f.slice(0, -".spec.ts".length));
}
