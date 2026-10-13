#!/usr/bin/env node
/* eslint-disable no-console -- CLI script: console is its output */
/**
 * Imports colour palettes into Vaultdraw's theme format (Noctalia palette
 * JSON: `{ name, author, dark: { m* roles, terminal }, light: {...} }`).
 *
 * Two sources:
 *
 * 1. Noctalia's built-in palettes (MIT), compiled into the shell as C++:
 *
 *      node scripts/import-noctalia-palettes.mjs [<builtin_palettes.cpp | URL>] [--out <dir>]
 *
 *    Without a source it fetches NOCTALIA_URL. Writes one `<slug>.json` per
 *    palette to --out (default src/theme/builtin/noctalia/) and removes
 *    `*.json` files there that the source no longer has, so it is safe to
 *    re-run after Noctalia updates its palettes.
 *
 * 2. A directory of palette folders already in our format
 *    (`<Name>/<Name>.json`, e.g. Noctalia community palettes):
 *
 *      node scripts/import-noctalia-palettes.mjs --from-dir <path> --out <dir> [--author <text>]
 *
 *    The folder name becomes "name"; --author sets "author" (a file's own
 *    author is kept after it). Colours are lower-cased and every file is validated with the theme
 *    engine's rules (src/theme/normalize.ts): object shape, `dark`/`light`
 *    blocks with mSurface/mOnSurface/mPrimary, valid hex colours. Invalid
 *    files are reported and skipped; nothing is deleted from --out.
 *
 * Exit code 1 when nothing could be imported or any file failed validation.
 */

import {
  readFile,
  readdir,
  mkdir,
  writeFile,
  rm,
  stat,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const NOCTALIA_URL =
  "https://raw.githubusercontent.com/noctalia-dev/noctalia/HEAD/src/theme/builtin_palettes.cpp";
const NOCTALIA_AUTHOR = "Noctalia (MIT) - github.com/noctalia-dev/noctalia";

const here = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_OUT = path.resolve(here, "../src/theme/builtin/noctalia");

// Mirrors src/theme/types.ts.
const ROLE_KEYS = [
  "mPrimary",
  "mOnPrimary",
  "mSecondary",
  "mOnSecondary",
  "mTertiary",
  "mOnTertiary",
  "mError",
  "mOnError",
  "mSurface",
  "mOnSurface",
  "mSurfaceVariant",
  "mOnSurfaceVariant",
  "mOutline",
  "mShadow",
  "mHover",
  "mOnHover",
];
const REQUIRED_ROLE_KEYS = ["mSurface", "mOnSurface", "mPrimary"];
const ANSI_KEYS = [
  "black",
  "red",
  "green",
  "yellow",
  "blue",
  "magenta",
  "cyan",
  "white",
];
const TERMINAL_EXTRA_KEYS = [
  "foreground",
  "background",
  "selectionFg",
  "selectionBg",
  "cursorText",
  "cursor",
];
const MODES = ["dark", "light"];
const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/** Same slug rule as the engine's slugify(). */
export const slugify = (name) =>
  name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "theme";

const isPlainObject = (v) =>
  typeof v === "object" && v !== null && !Array.isArray(v);

// ---------------------------------------------------------------------------
// Source 1: Noctalia's builtin_palettes.cpp
// ---------------------------------------------------------------------------

/** C++ field name -> our role key (primary -> mPrimary, onHover -> mOnHover). */
const roleKey = (field) => `m${field[0].toUpperCase()}${field.slice(1)}`;

/**
 * Parses the designated initialisers of `kPalettes`. The file is a flat
 * sequence of `.field = hex("#...")` / `.name = "..."` / `.dark =` lines, so
 * a small state machine over those tokens is enough (no brace matching).
 */
export const parseNoctaliaCpp = (source) => {
  const declared = /std::array<\s*BuiltinPalette\s*,\s*(\d+)\s*>/.exec(source);
  const token =
    /\.(\w+)\s*=\s*(?:hex\(\s*"([^"]*)"\s*\)|"((?:[^"\\]|\\.)*)")?/g;
  const palettes = [];
  let palette = null;
  let mode = null;
  let group = null; // "roles" | "terminal" | "normal" | "bright"

  for (const m of source.matchAll(token)) {
    const [, field, hexValue, stringValue] = m;
    if (field === "name" && stringValue !== undefined) {
      palette = { name: stringValue, dark: null, light: null };
      palettes.push(palette);
      mode = null;
      group = null;
      continue;
    }
    if (!palette) {
      continue;
    }
    if (field === "dark" || field === "light") {
      mode = field;
      palette[mode] = { terminal: { normal: {}, bright: {} } };
      group = null;
      continue;
    }
    if (field === "palette") {
      group = "roles";
      continue;
    }
    if (field === "terminal") {
      group = "terminal";
      continue;
    }
    if (field === "normal" || field === "bright") {
      group = field;
      continue;
    }
    if (hexValue === undefined || !mode) {
      continue;
    }
    const variant = palette[mode];
    const color = hexValue.trim().toLowerCase();
    if (
      (group === "normal" || group === "bright") &&
      ANSI_KEYS.includes(field)
    ) {
      variant.terminal[group][field] = color;
    } else if (TERMINAL_EXTRA_KEYS.includes(field)) {
      variant.terminal[field] = color;
    } else if (group === "roles" && ROLE_KEYS.includes(roleKey(field))) {
      variant[roleKey(field)] = color;
    } else {
      throw new Error(
        `${palette.name}.${mode}: unexpected field "${field}" (in ${
          group ?? "?"
        })`,
      );
    }
  }

  if (declared && Number(declared[1]) !== palettes.length) {
    throw new Error(
      `Expected ${declared[1]} palettes (std::array size) but parsed ${palettes.length}`,
    );
  }
  // Noctalia ships complete palettes: insist on every role and terminal colour.
  for (const p of palettes) {
    for (const mode of MODES) {
      const v = p[mode];
      if (!v) {
        throw new Error(`${p.name}: missing ${mode} block`);
      }
      const missing = [
        ...ROLE_KEYS.filter((k) => !v[k]),
        ...ANSI_KEYS.filter((k) => !v.terminal.normal[k]).map(
          (k) => `terminal.normal.${k}`,
        ),
        ...ANSI_KEYS.filter((k) => !v.terminal.bright[k]).map(
          (k) => `terminal.bright.${k}`,
        ),
        ...TERMINAL_EXTRA_KEYS.filter((k) => !v.terminal[k]).map(
          (k) => `terminal.${k}`,
        ),
      ];
      if (missing.length) {
        throw new Error(`${p.name}.${mode}: missing ${missing.join(", ")}`);
      }
    }
  }
  return palettes;
};

/** Stable key order: roles in ROLE_KEYS order, then the terminal block. */
const orderVariant = (v) => {
  const out = {};
  for (const k of ROLE_KEYS) {
    if (v[k] !== undefined) {
      out[k] = v[k];
    }
  }
  if (v.terminal) {
    const t = {};
    for (const set of ["normal", "bright"]) {
      if (v.terminal[set]) {
        t[set] = {};
        for (const k of ANSI_KEYS) {
          if (v.terminal[set][k] !== undefined) {
            t[set][k] = v.terminal[set][k];
          }
        }
      }
    }
    for (const k of TERMINAL_EXTRA_KEYS) {
      if (v.terminal[k] !== undefined) {
        t[k] = v.terminal[k];
      }
    }
    out.terminal = t;
  }
  return out;
};

// ---------------------------------------------------------------------------
// Source 2: a directory of `<Name>/<Name>.json` palettes
// ---------------------------------------------------------------------------

/**
 * Validates a palette with the engine's rules (normalize.ts readVariantInput)
 * and returns a copy with lower-cased colours, plus non-fatal warnings.
 * Throws with a clear message on anything the engine would reject.
 */
export const validatePalette = (json, fallbackName) => {
  const warnings = [];
  const fail = (msg) => {
    throw new Error(`Theme "${fallbackName}": ${msg}`);
  };
  const color = (value, where) => {
    if (typeof value !== "string" || !HEX_RE.test(value.trim())) {
      fail(
        `${where} must be a hex colour like "#rrggbb" (got ${JSON.stringify(
          value,
        )})`,
      );
    }
    return value.trim().toLowerCase();
  };
  if (!isPlainObject(json)) {
    fail(`expected a JSON object with "dark" and/or "light" blocks`);
  }
  if (
    json.name !== undefined &&
    (typeof json.name !== "string" || !json.name.trim())
  ) {
    fail(`"name" must be a non-empty string`);
  }
  if (json.author !== undefined && typeof json.author !== "string") {
    fail(`"author" must be a string`);
  }
  const out = { name: json.name?.trim() || fallbackName };
  if (typeof json.author === "string" && json.author.trim()) {
    out.author = json.author.trim();
  }
  for (const key of Object.keys(json)) {
    if (!["name", "author", "dark", "light", "$schema"].includes(key)) {
      warnings.push(`${key}: unknown key dropped`);
    }
  }
  for (const mode of MODES) {
    const raw = json[mode];
    if (raw === undefined) {
      continue;
    }
    if (!isPlainObject(raw)) {
      fail(`"${mode}" must be an object of colour roles`);
    }
    const missing = REQUIRED_ROLE_KEYS.filter((k) => raw[k] === undefined);
    if (missing.length) {
      fail(`"${mode}" is missing required colour(s) ${missing.join(", ")}`);
    }
    const v = {};
    for (const [key, value] of Object.entries(raw)) {
      if (ROLE_KEYS.includes(key)) {
        if (value !== undefined) {
          v[key] = color(value, `${mode}.${key}`);
        }
      } else if (key === "terminal") {
        if (!isPlainObject(value)) {
          fail(`${mode}.terminal must be an object`);
        }
        v.terminal = {};
        for (const [tk, tv] of Object.entries(value)) {
          const where = `${mode}.terminal.${tk}`;
          if (tk === "normal" || tk === "bright") {
            if (!isPlainObject(tv)) {
              fail(`${where} must be an object`);
            }
            v.terminal[tk] = {};
            for (const [ak, av] of Object.entries(tv)) {
              if (ANSI_KEYS.includes(ak)) {
                v.terminal[tk][ak] = color(av, `${where}.${ak}`);
              } else {
                warnings.push(`${where}.${ak}: unknown key dropped`);
              }
            }
          } else if (TERMINAL_EXTRA_KEYS.includes(tk)) {
            v.terminal[tk] = color(tv, where);
          } else {
            warnings.push(`${where}: unknown key dropped`);
          }
        }
      } else {
        warnings.push(`${mode}.${key}: unknown key dropped`);
      }
    }
    out[mode] = orderVariant(v);
  }
  if (!out.dark && !out.light) {
    fail(`needs a "dark" or "light" block (or both)`);
  }
  return { palette: out, warnings };
};

const readPaletteDir = async (dir, author) => {
  const results = [];
  const problems = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) {
      continue;
    }
    const file = path.join(dir, entry.name, `${entry.name}.json`);
    try {
      await stat(file);
    } catch {
      problems.push(
        `${entry.name}: no ${entry.name}/${entry.name}.json, skipped`,
      );
      continue;
    }
    try {
      const json = JSON.parse(await readFile(file, "utf8"));
      const { palette, warnings } = validatePalette(json, entry.name);
      // The folder name is the palette name users see (Noctalia's rule).
      if (palette.name !== entry.name) {
        warnings.push(
          `"name" ${JSON.stringify(palette.name)} replaced by the folder name`,
        );
        palette.name = entry.name;
      }
      if (author) {
        palette.author =
          palette.author && palette.author !== author
            ? `${author} - ${palette.author}`
            : author;
      }
      results.push({ palette, source: file });
      for (const w of warnings) {
        console.warn(`warning: ${entry.name}: ${w}`);
      }
    } catch (err) {
      problems.push(`${file}: ${err instanceof Error ? err.message : err}`);
    }
  }
  return { results, problems };
};

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const parseArgs = (argv) => {
  const opts = { source: null, fromDir: null, out: null, author: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) {
        throw new Error(`${a} needs a value`);
      }
      return v;
    };
    if (a === "--from-dir") {
      opts.fromDir = next();
    } else if (a === "--out") {
      opts.out = next();
    } else if (a === "--author") {
      opts.author = next();
    } else if (a === "-h" || a === "--help") {
      opts.help = true;
    } else if (a.startsWith("-")) {
      throw new Error(`Unknown option ${a}`);
    } else {
      opts.source = a;
    }
  }
  return opts;
};

const readSource = async (source) => {
  if (/^https?:\/\//.test(source)) {
    const res = await fetch(source);
    if (!res.ok) {
      throw new Error(`GET ${source}: ${res.status} ${res.statusText}`);
    }
    return res.text();
  }
  return readFile(source, "utf8");
};

const writePalettes = async (outDir, palettes) => {
  await mkdir(outDir, { recursive: true });
  const written = new Map();
  for (const p of palettes) {
    const slug = slugify(p.name);
    if (written.has(slug)) {
      throw new Error(
        `"${p.name}" and "${written.get(slug)}" both map to ${slug}.json`,
      );
    }
    written.set(slug, p.name);
    const body = { name: p.name };
    if (p.author) {
      body.author = p.author;
    }
    for (const mode of MODES) {
      if (p[mode]) {
        body[mode] = orderVariant(p[mode]);
      }
    }
    await writeFile(
      path.join(outDir, `${slug}.json`),
      `${JSON.stringify(body, null, 2)}\n`,
    );
  }
  return written;
};

const main = async () => {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(
      [
        "Usage:",
        "  import-noctalia-palettes.mjs [<builtin_palettes.cpp|URL>] [--out <dir>]",
        "  import-noctalia-palettes.mjs --from-dir <dir> --out <dir> [--author <text>]",
      ].join("\n"),
    );
    return;
  }

  if (opts.fromDir) {
    if (!opts.out) {
      throw new Error("--from-dir needs --out <dir>");
    }
    const { results, problems } = await readPaletteDir(
      path.resolve(opts.fromDir),
      opts.author,
    );
    const written = await writePalettes(
      path.resolve(opts.out),
      results.map((r) => r.palette),
    );
    for (const p of problems) {
      console.error(`error: ${p}`);
    }
    console.log(
      `Imported ${written.size} palette(s) into ${opts.out}${
        problems.length ? `; ${problems.length} problem(s)` : ""
      }`,
    );
    if (!written.size || problems.length) {
      process.exitCode = 1;
    }
    return;
  }

  const source = opts.source ?? NOCTALIA_URL;
  const outDir = path.resolve(opts.out ?? DEFAULT_OUT);
  const palettes = parseNoctaliaCpp(await readSource(source)).map((p) => ({
    ...p,
    author: NOCTALIA_AUTHOR,
  }));
  if (!palettes.length) {
    throw new Error(`No palettes found in ${source}`);
  }
  const written = await writePalettes(outDir, palettes);
  // Re-runnable: drop palettes Noctalia no longer ships.
  for (const file of await readdir(outDir)) {
    if (file.endsWith(".json") && !written.has(file.slice(0, -5))) {
      await rm(path.join(outDir, file));
      console.log(`removed stale ${file}`);
    }
  }
  console.log(
    `Wrote ${written.size} Noctalia palette(s) to ${path.relative(
      process.cwd(),
      outDir,
    )}: ${[...written.values()].join(", ")}`,
  );
};

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
