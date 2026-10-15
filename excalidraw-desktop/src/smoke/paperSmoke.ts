// Packaged-app smoke steps for notebook backgrounds (F20). runDesktopSmoke
// calls these inside its own `step()` wrapper, after the theme steps, so the
// paper default written to config.toml cannot disturb other config checks.

import { createBackgroundPattern } from "@excalidraw/excalidraw/data/backgroundPattern";

import { setDefaultBackgroundPattern } from "../vault/paperDefaults";

import {
  captureExport,
  closeDialog,
  dialogButton,
  openExportDialog,
} from "./exportSmoke";

import type { ExportSmokeContext } from "./exportSmoke";
import type { VaultEntry } from "../vault/types";

const PAPER_KEYS = [
  "paper.style",
  "paper.spacing",
  "paper.color",
  "paper.opacity",
  "paper.major_every",
  "paper.margin_line",
];

type Scene = { appState?: { viewBackgroundPattern?: { type?: string } } };

const readScene = async (ctx: ExportSmokeContext, path: string) =>
  JSON.parse(
    (await ctx.call("read_drawing", { handle: ctx.vaultHandle, path })).json,
  ) as Scene;

const savedPatternType = async (ctx: ExportSmokeContext, path: string) =>
  (await readScene(ctx, path)).appState?.viewBackgroundPattern?.type ?? null;

const pollSavedType = async (
  ctx: ExportSmokeContext,
  path: string,
  type: string | null,
) => {
  for (let i = 0; i < 40; i++) {
    if ((await savedPatternType(ctx, path)) === type) {
      return;
    }
    await ctx.delay(200);
  }
  throw new Error(
    `${path}: saved pattern is ${await savedPatternType(
      ctx,
      path,
    )}, expected ${type}`,
  );
};

/** Share of pixels in an RGBA buffer that differ from its first pixel. */
const inkShare = (data: Uint8ClampedArray) => {
  let ink = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (
      data[i] !== data[0] ||
      data[i + 1] !== data[1] ||
      data[i + 2] !== data[2]
    ) {
      ink++;
    }
  }
  return ink / (data.length / 4);
};

/** Ink share of an empty band of the static canvas (right of the islands). */
const staticCanvasInk = (ctx: ExportSmokeContext) => {
  const canvas = ctx.root.querySelector<HTMLCanvasElement>(
    ".vault-editor canvas.static",
  );
  const c2d = canvas?.getContext("2d");
  if (!canvas || !c2d || canvas.width < 100 || canvas.height < 100) {
    return null;
  }
  const w = Math.floor(canvas.width * 0.3);
  const h = Math.floor(canvas.height * 0.3);
  return inkShare(
    c2d.getImageData(
      Math.floor(canvas.width * 0.6),
      Math.floor(canvas.height * 0.4),
      w,
      h,
    ).data,
  );
};

const pngInkShare = async (ctx: ExportSmokeContext, bytes: Uint8Array) => {
  const bitmap = await ctx.win.createImageBitmap(
    new ctx.win.Blob([bytes as BlobPart], { type: "image/png" }),
  );
  const canvas = ctx.doc.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const c2d = canvas.getContext("2d")!;
  c2d.drawImage(bitmap, 0, 0);
  return {
    width: bitmap.width,
    height: bitmap.height,
    ink: inkShare(c2d.getImageData(0, 0, bitmap.width, bitmap.height).data),
  };
};

/** Back to plain paper in config.toml (keys removed, like a fresh config). */
export const resetPaperConfig = (ctx: ExportSmokeContext) =>
  ctx.call("update_config", {
    changes: PAPER_KEYS.map((key) => ({ key, value: null })),
  });

/**
 * Settings default "grid" -> written to config.toml [paper] -> a drawing
 * created from the header gets it in its file and draws it on the canvas.
 */
export const paperDefaultStampedStep = async (ctx: ExportSmokeContext) => {
  setDefaultBackgroundPattern(createBackgroundPattern("grid"), ctx.win);
  try {
    let style: unknown = null;
    for (let i = 0; i < 30 && style !== "grid"; i++) {
      style = (await ctx.call("load_settings")).config?.paper?.style;
      if (style !== "grid") {
        await ctx.delay(100);
      }
    }
    if (style !== "grid") {
      throw new Error(`config.toml paper.style is ${JSON.stringify(style)}`);
    }

    const list = async () =>
      (
        (await ctx.call("list_directory", {
          handle: ctx.vaultHandle,
          path: "",
        })) as VaultEntry[]
      ).filter((e) => e.kind === "drawing");
    const before = new Set((await list()).map((e) => e.path));
    // The header button is gone; Mod+N is the same command (no `code` + both
    // modifiers set = plain Mod on every OS, see chordFromEvent).
    ctx.root.ownerDocument.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "n",
        metaKey: true,
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    let created: string | null = null;
    for (let i = 0; i < 40 && !created; i++) {
      created = (await list()).find((e) => !before.has(e.path))?.path ?? null;
      if (!created) {
        await ctx.delay(200);
      }
    }
    if (!created) {
      throw new Error("New drawing command created no drawing in the root");
    }
    await pollSavedType(ctx, created, "grid");
    const ink = await ctx.waitFor(
      "grid pattern on the static canvas",
      () => {
        const share = staticCanvasInk(ctx);
        return share !== null && share > 0.005 && share < 0.5 ? share : null;
      },
      5000,
    );
    return { configStyle: style, created, staticCanvasInk: ink };
  } finally {
    await resetPaperConfig(ctx).catch(() => {});
  }
};

/** Picks a style (or "Plain") in the canvas menu's Paper row. */
const pickPaper = async (ctx: ExportSmokeContext, label: string) => {
  const trigger = await ctx.waitFor("main menu trigger", () =>
    ctx.root.querySelector<HTMLElement>(
      '.vault-editor [data-testid="main-menu-trigger"]',
    ),
  );
  trigger.click();
  const choice = await ctx.waitFor(`Paper ${label}`, () =>
    ctx.doc.querySelector<HTMLElement>(
      `.paper-menu label.paper-style[title="${label}"]`,
    ),
  );
  choice.click();
  if (ctx.doc.querySelector(".paper-menu")) {
    trigger.click();
  }
};

/**
 * Per-drawing paper on the smoke drawing (which has content): autosaved into
 * the file, then a PNG export with the pattern has more ink than without.
 */
export const paperDrawingPngExportStep = async (ctx: ExportSmokeContext) => {
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
  await pickPaper(ctx, "Lines");
  try {
    await pollSavedType(ctx, ctx.drawingPath, "lines");

    const modal = await openExportDialog(ctx);
    const exports: Array<{ width: number; height: number; ink: number }> = [];
    try {
      const patternSwitch = await ctx.waitFor("pattern switch", () =>
        modal.querySelector<HTMLInputElement>(
          'input[name="exportBackgroundPatternSwitch"]',
        ),
      );
      for (const on of [true, false]) {
        if (patternSwitch.checked !== on) {
          patternSwitch.click();
          await ctx.waitFor("pattern switch toggled", () =>
            patternSwitch.checked === on ? true : null,
          );
        }
        const file = await captureExport(ctx, () =>
          dialogButton(modal, "PNG").click(),
        );
        exports.push(await pngInkShare(ctx, file.bytes));
      }
      // Leave the remembered export option on.
      patternSwitch.click();
    } finally {
      await closeDialog(ctx);
    }
    const [withPattern, without] = exports;
    if (
      withPattern.width !== without.width ||
      withPattern.ink <= without.ink + 0.005
    ) {
      throw new Error(
        `PNG with pattern does not show it: ${JSON.stringify(exports)}`,
      );
    }
    return { withPattern, without };
  } finally {
    await pickPaper(ctx, "Plain").catch(() => {});
    await pollSavedType(ctx, ctx.drawingPath, null).catch(() => {});
  }
};
