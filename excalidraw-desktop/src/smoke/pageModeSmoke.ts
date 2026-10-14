// Packaged-app smoke steps for Page mode. runDesktopSmoke calls these inside
// its own `step()` wrapper, after the paper steps. The two drawing steps run
// first and leave page mode off; the default-stamped step writes [page] to
// config.toml, so it goes last and resets the config.

import { getRegisteredHandler } from "../commands/handlerRegistry";
import {
  getDefaultPageSetup,
  setDefaultPageSetup,
} from "../vault/pageDefaults";

import { captureExport } from "./exportSmoke";

import type { ExportSmokeContext } from "./exportSmoke";
import type { VaultEntry } from "../vault/types";

const PAGE_KEYS = [
  "page.mode",
  "page.layout",
  "page.size",
  "page.orientation",
  "page.width",
  "page.height",
  "page.paper_theme",
];

type SavedPageSetup = {
  enabled?: boolean;
  size?: string;
  width?: number;
  height?: number;
  pageCount?: number;
};
type Scene = { appState?: { pageSetup?: SavedPageSetup | null } };

const savedSetup = async (ctx: ExportSmokeContext, path: string) =>
  (
    JSON.parse(
      (await ctx.call("read_drawing", { handle: ctx.vaultHandle, path })).json,
    ) as Scene
  ).appState?.pageSetup ?? null;

/** Polls the autosaved file until `test` holds for its pageSetup. */
const pollSaved = async (
  ctx: ExportSmokeContext,
  path: string,
  label: string,
  test: (setup: SavedPageSetup | null) => boolean,
) => {
  let setup: SavedPageSetup | null = null;
  for (let i = 0; i < 40; i++) {
    setup = await savedSetup(ctx, path);
    if (test(setup)) {
      return setup;
    }
    await ctx.delay(200);
  }
  throw new Error(
    `${path}: saved pageSetup ${JSON.stringify(setup)} is not ${label}`,
  );
};

const openSmokeDrawing = async (ctx: ExportSmokeContext) => {
  const row = await ctx.waitFor("smoke drawing tree row", () =>
    ctx.root.querySelector<HTMLElement>(
      `.vault-tree-item__name[title="${ctx.drawingPath}"]`,
    ),
  );
  row.closest<HTMLElement>(".vault-tree-item")?.click();
  await ctx.waitFor("smoke drawing active", () =>
    ctx.root.querySelector<HTMLElement>(
      ".vault-tree-item--active .vault-tree-item__name",
    )?.title === ctx.drawingPath
      ? true
      : null,
  );
};

/** Runs an editor command through the registry the palette and hotkeys use. */
const runEditorCommand = async (ctx: ExportSmokeContext, id: string) => {
  const handler = await ctx.waitFor(`handler for ${id}`, () =>
    getRegisteredHandler(id),
  );
  await handler();
};

/** Runs a shell command from the command palette (Cmd+P, ">" + its title). */
const runPaletteCommand = async (ctx: ExportSmokeContext, title: string) => {
  const dialog = () =>
    ctx.doc.querySelector<HTMLElement>(
      '[role="dialog"][aria-label="Command palette"]',
    );
  const key = (init: KeyboardEventInit, target: EventTarget) =>
    target.dispatchEvent(
      new ctx.win.KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        ...init,
      }),
    );
  key({ key: "p", code: "KeyP", metaKey: true }, ctx.doc);
  const input = await ctx.waitFor("command palette input", () =>
    dialog()?.querySelector<HTMLInputElement>(".vault-quick__input"),
  );
  Object.getOwnPropertyDescriptor(
    ctx.win.HTMLInputElement.prototype,
    "value",
  )!.set!.call(input, `>${title}`);
  input.dispatchEvent(new ctx.win.Event("input", { bubbles: true }));
  await ctx.waitFor(`palette row "${title}"`, () =>
    dialog()?.querySelector(".vault-quick__row")?.textContent?.includes(title)
      ? true
      : null,
  );
  key({ key: "Enter", code: "Enter" }, input);
  await ctx.waitFor("command palette closed", () => (dialog() ? null : true));
};

/** page.on writes pageSetup.enabled into the file; page.off restores it. */
export const pageModeSwitchStep = async (ctx: ExportSmokeContext) => {
  await openSmokeDrawing(ctx);
  try {
    await runEditorCommand(ctx, "page.on");
    const on = await pollSaved(
      ctx,
      ctx.drawingPath,
      "enabled",
      (s) => s?.enabled === true,
    );
    await runEditorCommand(ctx, "page.off");
    const off = await pollSaved(
      ctx,
      ctx.drawingPath,
      "disabled",
      (s) => s === null || s.enabled === false,
    );
    return { on, off };
  } finally {
    await runEditorCommand(ctx, "page.off").catch(() => {});
  }
};

/** Settings default "page" -> [page] in config.toml -> new drawings are stamped. */
export const pageDefaultStampedStep = async (ctx: ExportSmokeContext) => {
  setDefaultPageSetup(
    { ...getDefaultPageSetup(ctx.win), enabled: true },
    ctx.win,
  );
  try {
    let mode: unknown = null;
    for (let i = 0; i < 30 && mode !== "page"; i++) {
      mode = (await ctx.call("load_settings")).config?.page?.mode;
      if (mode !== "page") {
        await ctx.delay(100);
      }
    }
    if (mode !== "page") {
      throw new Error(`config.toml page.mode is ${JSON.stringify(mode)}`);
    }
    const expected = getDefaultPageSetup(ctx.win);

    const list = async () =>
      (
        (await ctx.call("list_directory", {
          handle: ctx.vaultHandle,
          path: "",
        })) as VaultEntry[]
      ).filter((e) => e.kind === "drawing");
    const before = new Set((await list()).map((e) => e.path));
    const header = await ctx.waitFor("header New Drawing", () =>
      ctx.root.querySelector<HTMLButtonElement>(
        '.vault-header [aria-label="New Drawing"]',
      ),
    );
    header.click();
    let created: string | null = null;
    for (let i = 0; i < 40 && !created; i++) {
      created = (await list()).find((e) => !before.has(e.path))?.path ?? null;
      if (!created) {
        await ctx.delay(200);
      }
    }
    if (!created) {
      throw new Error("Header New Drawing created no drawing in the root");
    }
    const setup = await pollSaved(
      ctx,
      created,
      `enabled ${expected.size} ${expected.width}x${expected.height}`,
      (s) =>
        s?.enabled === true &&
        s.size === expected.size &&
        s.width === expected.width &&
        s.height === expected.height,
    );
    return { configMode: mode, created, setup };
  } finally {
    await resetPageConfig(ctx).catch(() => {});
  }
};

/** Back to normal mode in config.toml (keys removed, like a fresh config). */
export const resetPageConfig = (ctx: ExportSmokeContext) =>
  ctx.call("update_config", {
    changes: PAGE_KEYS.map((key) => ({ key, value: null })),
  });

/** file.exportPdf on a page-mode drawing: a valid PDF with one page per sheet. */
export const pagePdfExportStep = async (ctx: ExportSmokeContext) => {
  await openSmokeDrawing(ctx);
  try {
    await runEditorCommand(ctx, "page.on");
    const setup = await pollSaved(
      ctx,
      ctx.drawingPath,
      "enabled",
      (s) => s?.enabled === true && (s.pageCount ?? 0) >= 1,
    );
    const pdf = await captureExport(
      ctx,
      () => runPaletteCommand(ctx, "Export: PDF"),
      30_000,
    );
    const text = new TextDecoder("latin1").decode(pdf.bytes);
    if (!text.startsWith("%PDF-")) {
      throw new Error(
        `Not a PDF: starts with ${JSON.stringify(text.slice(0, 8))}`,
      );
    }
    if (!text.trimEnd().endsWith("%%EOF")) {
      throw new Error("PDF does not end with %%EOF");
    }
    const pages = (text.match(/\/Type\s*\/Page(?![A-Za-z])/g) ?? []).length;
    if (pages !== setup!.pageCount) {
      throw new Error(
        `PDF has ${pages} pages, drawing has pageCount ${setup!.pageCount}`,
      );
    }
    return { name: pdf.name, bytes: pdf.bytes.byteLength, pages };
  } finally {
    await runEditorCommand(ctx, "page.off").catch(() => {});
    await pollSaved(
      ctx,
      ctx.drawingPath,
      "disabled",
      (s) => s === null || s.enabled === false,
    ).catch(() => {});
  }
};
