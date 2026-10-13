/**
 * Bundled themes: sources and clash rules, lazy parsing, cheap summaries,
 * and the startup cost of building the theme list.
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  builtinThemeFiles,
  getBuiltinTheme,
  loadBuiltinThemes,
  previewFromTheme,
} from "../theme";
import { parsedBuiltinCount, resetBuiltinCaches } from "../theme/builtins";
import {
  builtinRegistry,
  listThemeSummaries,
  resolveTheme,
  setThemeRegistry,
} from "../theme/registry";
import { computeAppearance } from "../vault/appearance";

afterEach(() => setThemeRegistry(null));

const NOCTALIA = [
  "ayu",
  "catppuccin",
  "dracula",
  "eldritch",
  "gruvbox",
  "kanagawa",
  "noctalia",
  "nord",
  "rose-pine",
  "tokyo-night",
];

describe("bundled theme sources", () => {
  const files = builtinThemeFiles();
  const origin = (id: string) => files.find((f) => f.id === id)?.origin;

  it("Noctalia's palettes replace ours; community replaces ours; Default stays", () => {
    for (const id of NOCTALIA) {
      expect(origin(id), id).toBe("noctalia");
      expect(files.find((f) => f.id === id)?.author).toMatch(
        /^Noctalia \(MIT\)/,
      );
    }
    // Community palettes with the same name as an older Vaultdraw built-in.
    expect(origin("everforest")).toBe("community");
    expect(origin("solarized")).toBe("community");
    expect(
      files.filter((f) => f.origin === "vaultdraw").map((f) => f.id),
    ).toEqual(["default"]);
    expect(files[0].id).toBe("default");
    expect(
      files
        .filter((f) => f.origin === "community")
        .every((f) => f.author === "Noctalia community palettes"),
    ).toBe(true);
    expect(files.length).toBe(120);
  });

  it("records which bundled palettes carry (harmless) warnings", () => {
    const withWarnings = loadBuiltinThemes().filter((t) => t.warnings.length);
    const noctalia = withWarnings
      .filter((t) => origin(t.id) === "noctalia")
      .map((t) => t.id);
    // Light variants whose on-primary text is below 3:1; tokens adjust it.
    expect(noctalia).toEqual(["ayu", "gruvbox", "rose-pine"]);
    for (const t of withWarnings) {
      for (const w of t.warnings) {
        expect(w, t.id).toMatch(/low contrast|is too (light|dark) for/);
      }
    }
    const community = withWarnings.filter((t) => origin(t.id) === "community");
    expect(community.length).toBe(37);
  });
});

describe("lazy built-ins", () => {
  it("building the registry and the summaries parses nothing", () => {
    resetBuiltinCaches();
    const registry = builtinRegistry();
    expect(registry.themes).toHaveLength(builtinThemeFiles().length);
    const summaries = listThemeSummaries(registry);
    expect(summaries).toHaveLength(registry.themes.length);
    expect(summaries[0]).toMatchObject({
      key: "Default",
      id: "default",
      source: "builtin",
      origin: "vaultdraw",
    });
    expect(parsedBuiltinCount()).toBe(0);

    // Selecting a theme parses just that one.
    const snap = computeAppearance(
      { theme: "dark", colorTheme: "Tokyo Night", syncCanvas: false },
      registry,
      window,
    );
    expect(snap.entry.id).toBe("tokyo-night");
    expect(snap.variant.mSurface).toBe(snap.entry.theme.dark.mSurface);
    expect(parsedBuiltinCount()).toBe(1);
    expect(resolveTheme("dracula", registry)?.name).toBe("Dracula");
    expect(parsedBuiltinCount()).toBe(2);
    expect(resolveTheme("nope", registry)).toBeNull();
  });

  it("summary previews match the fully resolved themes", () => {
    for (const s of listThemeSummaries(builtinRegistry())) {
      const theme = getBuiltinTheme(s.id)!;
      expect(s.preview, s.id).toEqual(previewFromTheme(theme));
      expect(s.name).toBe(theme.name);
      expect(s.author).toBe(theme.author);
    }
  });

  it("startup: summaries for every built-in vs parsing every built-in", () => {
    const time = (fn: () => void) => {
      const runs: number[] = [];
      for (let i = 0; i < 5; i++) {
        resetBuiltinCaches();
        const t0 = performance.now();
        fn();
        runs.push(performance.now() - t0);
      }
      return runs.sort((a, b) => a - b)[2];
    };
    const summaries = time(() => {
      listThemeSummaries(builtinRegistry());
    });
    const full = time(() => {
      loadBuiltinThemes();
    });
    // eslint-disable-next-line no-console
    console.info(
      `[theme startup] ${
        builtinThemeFiles().length
      } built-ins: summaries ${summaries.toFixed(
        2,
      )} ms (median of 5), full parse ${full.toFixed(2)} ms`,
    );
    expect(summaries).toBeLessThan(full);
  });
});
