/**
 * Packaged-app smoke steps for the image export dialog, the native clipboard
 * and Mermaid (F27 / F16). Kept out of runDesktopSmoke.ts: that file builds
 * the context once and calls these helpers inside its own `step()` wrapper.
 */

import { EDITOR_LS_KEYS } from "@excalidraw/common";
import { convertToExcalidrawElements } from "@excalidraw/excalidraw";
import { getDefaultAppState } from "@excalidraw/excalidraw/appState";

import type { ImageExportRequest } from "@excalidraw/excalidraw/types";

import { renderImageExport } from "../editor/imageExport";
import { desktopRepository } from "../vault/DesktopVaultRepository";
import { copyToClipboard } from "../vault/clipboard";
import { getPreferences } from "../vault/preferences";

export type Rgba = [number, number, number, number];

export type ExportSmokeContext = {
  doc: Document;
  win: Window & typeof globalThis;
  root: HTMLElement;
  waitFor: <T>(
    label: string,
    read: () => T | null | undefined,
    ms?: number,
  ) => Promise<T>;
  delay: (ms: number) => Promise<void>;
  call: (command: string, args?: Record<string, unknown>) => Promise<any>;
  /** Progress mark in smoke-progress.log (survives a hung run). */
  mark: (label: string) => Promise<unknown>;
  vaultHandle: string;
  drawingPath: string;
  staticCanvasPixel: () => Rgba | null;
  hexToRgb: (hex: string) => Rgba;
  near: (a: Rgba | null, b: Rgba, tolerance?: number) => boolean;
  rgbHex: (p: Rgba | null) => string | null;
  /** Runs `work` while CSP reports from SVG export are tracked separately. */
  withSvgCsp: <T>(work: () => Promise<T>) => Promise<T>;
  /** Colours of the active theme (must never appear in exports). */
  themeColours: Set<string>;
  darkCanvas: string;
};

export type CapturedExport = {
  name: string;
  bytes: Uint8Array;
  nativeWritten: boolean | null;
};

const ABSURD_MS = 10_000;
let exportCounter = 0;

const round = (n: number, digits = 1) => {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
};
const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

// ---------------------------------------------------------------- UI helpers

const menuItem = async (
  ctx: ExportSmokeContext,
  label: string,
  match: (el: HTMLElement) => boolean,
) => {
  const trigger = await ctx.waitFor("main menu trigger", () =>
    ctx.root.querySelector<HTMLElement>(
      '.vault-editor [data-testid="main-menu-trigger"]',
    ),
  );
  trigger.click();
  const item = await ctx.waitFor(`${label} menu item`, () =>
    Array.from(
      ctx.doc.querySelectorAll<HTMLElement>(".excalidraw .dropdown-menu-item"),
    ).find(match),
  );
  return item;
};

export const menuLabels = async (ctx: ExportSmokeContext) => {
  await menuItem(ctx, "any", () => true);
  const labels = Array.from(
    ctx.doc.querySelectorAll<HTMLElement>(".excalidraw .dropdown-menu-item"),
  ).map((el) => el.textContent?.trim() ?? "");
  // close the menu again
  ctx.root
    .querySelector<HTMLElement>(
      '.vault-editor [data-testid="main-menu-trigger"]',
    )
    ?.click();
  return labels;
};

export const openExportDialog = async (ctx: ExportSmokeContext) => {
  const item = await menuItem(
    ctx,
    "Export image...",
    (el) => el.getAttribute("data-testid") === "image-export-button",
  );
  item.click();
  const modal = await ctx.waitFor("export dialog", () =>
    ctx.doc.querySelector<HTMLElement>(".ImageExportModal"),
  );
  // With a selection (e.g. the image left by the file-drop step) the dialog
  // defaults to "Only selected"; these steps check whole-scene exports.
  const onlySelected = modal.querySelector<HTMLInputElement>(
    'input[name="exportOnlySelected"]',
  );
  if (onlySelected?.checked) {
    onlySelected.click();
    await ctx.waitFor("only selected off", () =>
      onlySelected.checked ? null : true,
    );
  }
  return modal;
};

/** Closes the top dialog via its backdrop (large dialogs have no close button). */
export const closeDialog = async (ctx: ExportSmokeContext) => {
  const backdrop = ctx.doc.querySelector<HTMLElement>(".Modal__background");
  if (backdrop) {
    backdrop.click();
    await ctx.waitFor("dialog closed", () =>
      ctx.doc.querySelector(".Modal") ? null : true,
    );
  }
};

export const dialogButton = (modal: HTMLElement, label: string) => {
  const found = Array.from(modal.querySelectorAll("button")).find(
    (b) => b.textContent?.trim() === label,
  );
  if (!found) {
    throw new Error(`Export dialog button not found: ${label}`);
  }
  return found as HTMLButtonElement;
};

export const readDialogOptions = (modal: HTMLElement) => {
  const checked = (name: string) =>
    !!modal.querySelector<HTMLInputElement>(`input[name="${name}"]`)?.checked;
  const scaleChoice = Array.from(
    modal.querySelectorAll<HTMLElement>(".RadioGroup__choice"),
  ).find((c) => c.querySelector<HTMLInputElement>("input")?.checked);
  return {
    scale: Number.parseInt(scaleChoice?.textContent ?? "", 10),
    background: checked("exportBackgroundSwitch"),
    embedScene: checked("exportEmbedSwitch"),
  };
};

export const setDialogOptions = async (
  ctx: ExportSmokeContext,
  modal: HTMLElement,
  wanted: Partial<ReturnType<typeof readDialogOptions>>,
) => {
  const toggle = (name: string, on: boolean) => {
    const input = modal.querySelector<HTMLInputElement>(
      `input[name="${name}"]`,
    );
    if (!input) {
      throw new Error(`Export dialog switch missing: ${name}`);
    }
    if (input.checked !== on) {
      input.click();
    }
  };
  if (wanted.background !== undefined) {
    toggle("exportBackgroundSwitch", wanted.background);
  }
  if (wanted.embedScene !== undefined) {
    toggle("exportEmbedSwitch", wanted.embedScene);
  }
  if (wanted.scale !== undefined) {
    const choice = Array.from(
      modal.querySelectorAll<HTMLElement>(".RadioGroup__choice"),
    ).find((c) => c.textContent?.trim() === `${wanted.scale}×`);
    choice?.querySelector<HTMLInputElement>("input")?.click();
  }
  await ctx.waitFor(
    "dialog options applied",
    () => {
      const now = readDialogOptions(modal);
      return (wanted.background === undefined ||
        now.background === wanted.background) &&
        (wanted.embedScene === undefined ||
          now.embedScene === wanted.embedScene) &&
        (wanted.scale === undefined || now.scale === wanted.scale)
        ? now
        : null;
    },
    3000,
  );
};

/**
 * Runs `trigger` and returns the bytes handed to the repository's exportFile,
 * which is still called for real (unique name: the smoke sandbox never
 * overwrites).
 */
export const captureExport = async (
  ctx: ExportSmokeContext,
  trigger: () => void | Promise<void>,
  waitMs = 15_000,
): Promise<CapturedExport> => {
  const original = desktopRepository.exportFile;
  let captured: CapturedExport | null = null;
  let failure: string | null = null;
  desktopRepository.exportFile = async (name: string, bytes: Uint8Array) => {
    exportCounter += 1;
    const entry: CapturedExport = { name, bytes, nativeWritten: null };
    captured = entry;
    try {
      entry.nativeWritten = await original.call(
        desktopRepository,
        `smoke-${exportCounter}-${name}`,
        bytes,
      );
    } catch (error) {
      failure = String(error);
      throw error;
    }
    return entry.nativeWritten;
  };
  try {
    await trigger();
    await ctx.waitFor(
      "export written",
      () => {
        if (failure) {
          throw new Error(`native export failed: ${failure}`);
        }
        const entry = captured as CapturedExport | null;
        return entry && entry.nativeWritten !== null ? entry : null;
      },
      waitMs,
    );
  } finally {
    desktopRepository.exportFile = original;
  }
  return captured as unknown as CapturedExport;
};

/** Menu > Export image... > click the dialog's PNG or SVG button. */
export const exportViaDialog = async (
  ctx: ExportSmokeContext,
  kind: "PNG" | "SVG",
) => {
  const modal = await openExportDialog(ctx);
  const run = () => captureExport(ctx, () => dialogButton(modal, kind).click());
  try {
    return await (kind === "SVG" ? ctx.withSvgCsp(run) : run());
  } finally {
    await closeDialog(ctx);
  }
};

// ------------------------------------------------------------ image helpers

export const decodePng = async (ctx: ExportSmokeContext, bytes: Uint8Array) => {
  const sig = Array.from(bytes.slice(0, 4)).join(",");
  if (sig !== "137,80,78,71") {
    throw new Error(`Not a PNG (signature ${sig})`);
  }
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
    pixel: (x: number, y: number): Rgba => {
      const d = c2d.getImageData(x, y, 1, 1).data;
      return [d[0], d[1], d[2], d[3]];
    },
  };
};

const svgColours = (svg: string) =>
  Array.from(
    new Set(
      (svg.match(/#[0-9a-fA-F]{6}\b/g) ?? []).map((c) => c.toLowerCase()),
    ),
  );

const readClipboard = (ctx: ExportSmokeContext) =>
  ctx.call("smoke_read_clipboard") as Promise<{
    types: string[];
    pngBytes: number | null;
    svgText: string | null;
  }>;

const SENTINEL =
  '<svg data-smoke-sentinel="1" xmlns="http://www.w3.org/2000/svg"/>';

/** Replaces the pasteboard with a known SVG so stale content never passes. */
const clearClipboard = async (ctx: ExportSmokeContext) => {
  await copyToClipboard("svg", new TextEncoder().encode(SENTINEL), ctx.win);
  const now = await readClipboard(ctx);
  if (now.pngBytes) {
    throw new Error(`Sentinel copy left a PNG on the clipboard: ${now.types}`);
  }
};

const waitClipboard = async <T>(
  ctx: ExportSmokeContext,
  label: string,
  pick: (clip: Awaited<ReturnType<typeof readClipboard>>) => T | null,
  ms = 10_000,
) => {
  const started = ctx.win.performance.now();
  let last: Awaited<ReturnType<typeof readClipboard>> | null = null;
  const until = started + ms;
  while (ctx.win.performance.now() < until) {
    last = await readClipboard(ctx);
    const picked = pick(last);
    if (picked != null) {
      return {
        value: picked,
        ms: round(ctx.win.performance.now() - started),
      };
    }
    await ctx.delay(25);
  }
  throw new Error(
    `Timed out waiting for ${label}; clipboard: ${JSON.stringify({
      types: last?.types,
      pngBytes: last?.pngBytes,
      svg: last?.svgText?.slice(0, 80),
    })}`,
  );
};

// ------------------------------------------------------- resource watching

const LOCAL_PROTOCOLS = new Set(["tauri:", "ipc:", "asset:", "data:", "blob:"]);
const LOCAL_HOSTS = new Set([
  "tauri.localhost",
  "ipc.localhost",
  "asset.localhost",
  "localhost",
]);

const isLocalUrl = (name: string, origin: string) => {
  try {
    const url = new URL(name);
    return (
      LOCAL_PROTOCOLS.has(url.protocol) ||
      url.origin === origin ||
      ((url.protocol === "http:" || url.protocol === "https:") &&
        LOCAL_HOSTS.has(url.hostname))
    );
  } catch {
    return false;
  }
};

/** Collects every resource request from now on (not capped by the buffer). */
const watchResources = (win: Window & typeof globalThis) => {
  const names: string[] = [];
  const observer = new win.PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      names.push(entry.name);
    }
  });
  observer.observe({ type: "resource" });
  return () => {
    for (const entry of observer.takeRecords()) {
      names.push(entry.name);
    }
    observer.disconnect();
    return {
      requests: names.length,
      nonLocal: names.filter((n) => !isLocalUrl(n, win.location.origin)),
      sample: names.slice(0, 6).map((n) => n.slice(0, 90)),
    };
  };
};

const startHeartbeat = (win: Window & typeof globalThis) => {
  let stopped = false;
  let last = win.performance.now();
  let maxGap = 0;
  const gaps: number[] = [];
  const tick = () => {
    const now = win.performance.now();
    const gap = now - last;
    last = now;
    gaps.push(gap);
    maxGap = Math.max(maxGap, gap);
    if (!stopped) {
      win.setTimeout(tick, 0);
    }
  };
  win.setTimeout(tick, 0);
  return () => {
    stopped = true;
    return { maxGapMs: round(maxGap), ticks: gaps.length };
  };
};

/** Snapshot of the editor's saved Mermaid text; the returned fn restores it. */
const snapshotMermaidText = (win: Window & typeof globalThis) => {
  const key = EDITOR_LS_KEYS.MERMAID_TO_EXCALIDRAW;
  let saved: string | null = null;
  try {
    saved = win.localStorage.getItem(key);
  } catch {
    // storage unavailable
  }
  return () => {
    try {
      if (saved === null) {
        win.localStorage.removeItem(key);
      } else {
        win.localStorage.setItem(key, saved);
      }
    } catch {
      // storage unavailable
    }
  };
};

const countLive = async (ctx: ExportSmokeContext) => {
  const file = await ctx.call("read_drawing", {
    handle: ctx.vaultHandle,
    path: ctx.drawingPath,
  });
  const scene = JSON.parse(file.json) as {
    elements: Array<{ isDeleted?: boolean }>;
  };
  return scene.elements.filter((e) => !e.isDeleted).length;
};

// ------------------------------------------------------------------- steps

/** a. options in the dialog: scale, background, embed scene, remembered. */
export const exportDialogOptionsStep = async (ctx: ExportSmokeContext) => {
  const menu = await menuLabels(ctx);
  for (const wanted of [
    "Export image...",
    "Save a copy…",
    "Insert Mermaid diagram…",
  ]) {
    const alt = wanted.replace("...", "…");
    if (!menu.some((l) => l.startsWith(wanted) || l.startsWith(alt))) {
      throw new Error(`Main menu lacks "${wanted}": ${JSON.stringify(menu)}`);
    }
  }
  if (menu.some((l) => /^Export as (PNG|SVG)/.test(l))) {
    throw new Error(`Old export menu items still present: ${menu}`);
  }

  const modal = await openExportDialog(ctx);
  const initial = readDialogOptions(modal);
  // The dialog's live preview must show standard colours, not the theme's
  // canvas sync. Checked on the first preview (rendered as the dialog opens).
  const previewCanvas = await ctx.waitFor(
    "dialog preview canvas",
    () =>
      modal.querySelector<HTMLCanvasElement>(
        ".ImageExportModal__preview canvas",
      ),
    5000,
  );
  await ctx.delay(300);
  const previewPixel = ((): Rgba => {
    const canvas =
      modal.querySelector<HTMLCanvasElement>(
        ".ImageExportModal__preview canvas",
      ) ?? previewCanvas;
    const d = canvas.getContext("2d")!.getImageData(1, 1, 1, 1).data;
    return [d[0], d[1], d[2], d[3]];
  })();
  if (
    previewPixel[3] === 255 &&
    !ctx.near(previewPixel, ctx.hexToRgb(ctx.darkCanvas))
  ) {
    throw new Error(
      `Dialog preview corner ${ctx.rgbHex(previewPixel)}, expected standard ${
        ctx.darkCanvas
      } (theme colours leaked)`,
    );
  }

  await setDialogOptions(ctx, modal, {
    scale: 1,
    background: true,
    embedScene: false,
  });
  const png1 = await captureExport(ctx, () =>
    dialogButton(modal, "PNG").click(),
  );
  const dim1 = await decodePng(ctx, png1.bytes);
  const corner1 = dim1.pixel(2, 2);

  const svg1 = await ctx.withSvgCsp(() =>
    captureExport(ctx, () => dialogButton(modal, "SVG").click()),
  );

  await setDialogOptions(ctx, modal, { scale: 3, background: false });
  const png3 = await captureExport(ctx, () =>
    dialogButton(modal, "PNG").click(),
  );
  const dim3 = await decodePng(ctx, png3.bytes);
  const corner3 = dim3.pixel(2, 2);
  if (
    Math.abs(dim3.width - dim1.width * 3) > 6 ||
    Math.abs(dim3.height - dim1.height * 3) > 6
  ) {
    throw new Error(
      `3x PNG is ${dim3.width}x${dim3.height}, 1x is ${dim1.width}x${dim1.height}`,
    );
  }
  if (corner3[3] !== 0) {
    throw new Error(
      `Background off: corner pixel ${ctx.rgbHex(corner3)} opaque`,
    );
  }
  if (corner1[3] !== 255) {
    throw new Error(`Background on: corner pixel ${ctx.rgbHex(corner1)}`);
  }

  // Remembered: preferences (state.json) and the reopened dialog.
  const stored = getPreferences(ctx.win).exportOptions;
  if (stored.scale !== 3 || stored.background !== false) {
    throw new Error(`Options not stored: ${JSON.stringify(stored)}`);
  }
  await closeDialog(ctx);
  const reopened = await openExportDialog(ctx);
  const remembered = readDialogOptions(reopened);
  if (remembered.scale !== 3 || remembered.background !== false) {
    throw new Error(`Reopened dialog shows ${JSON.stringify(remembered)}`);
  }

  await setDialogOptions(ctx, reopened, { embedScene: true });
  const embedded = await captureExport(ctx, () =>
    dialogButton(reopened, "PNG").click(),
  );
  if (!embedded.name.endsWith(".excalidraw.png")) {
    throw new Error(`Embed-scene export is named ${embedded.name}`);
  }
  const latin1 = new TextDecoder("latin1").decode(embedded.bytes);
  const hasScene = latin1.includes("application/vnd.excalidraw+json");

  const svgEmbedded = await ctx.withSvgCsp(() =>
    captureExport(ctx, () => dialogButton(reopened, "SVG").click()),
  );
  if (!svgEmbedded.name.endsWith(".excalidraw.svg")) {
    throw new Error(`Embed-scene SVG is named ${svgEmbedded.name}`);
  }

  const svgWidth = (bytes: Uint8Array) =>
    Number(
      /<svg[^>]*\swidth="([\d.]+)"/.exec(new TextDecoder().decode(bytes))?.[1],
    );
  const svg1Width = svgWidth(svg1.bytes);
  const svg3Width = svgWidth(svgEmbedded.bytes);
  if (!(Math.abs(svg3Width - svg1Width * 3) <= 6)) {
    throw new Error(`3x SVG width ${svg3Width}, 1x SVG width ${svg1Width}`);
  }

  // Back to what the user had so later steps see the defaults.
  await setDialogOptions(ctx, reopened, initial);
  await closeDialog(ctx);
  await waitForRestoredCanvas(ctx);
  return {
    menu,
    initial,
    previewCorner: ctx.rgbHex(previewPixel),
    png1x: { size: `${dim1.width}x${dim1.height}`, bytes: png1.bytes.length },
    svgWidth1x: svg1Width,
    svgWidth3x: svg3Width,
    png3x: { size: `${dim3.width}x${dim3.height}`, bytes: png3.bytes.length },
    corner1x: ctx.rgbHex(corner1),
    corner3xNoBackground: ctx.rgbHex(corner3),
    stored,
    remembered,
    embeddedName: embedded.name,
    embeddedSceneInPng: hasScene,
    embeddedSvgName: svgEmbedded.name,
  };
};

const waitForRestoredCanvas = (ctx: ExportSmokeContext) =>
  ctx.waitFor(
    "theme canvas restored after the dialog closed",
    () => {
      const p = ctx.staticCanvasPixel();
      return p && !ctx.near(p, ctx.hexToRgb(ctx.darkCanvas), 1) ? true : null;
    },
    4000,
  );

/** b. Copy PNG / Copy SVG reach the native pasteboard in standard colours. */
export const clipboardCopyStep = async (ctx: ExportSmokeContext) => {
  const modal = await openExportDialog(ctx);
  await setDialogOptions(ctx, modal, { background: true, embedScene: false });
  const fileExport = await captureExport(ctx, () =>
    dialogButton(modal, "PNG").click(),
  );

  void ctx.mark("clipboard: copy png");
  await clearClipboard(ctx);
  dialogButton(modal, "Copy PNG").click();
  const png = await waitClipboard(ctx, "PNG on the clipboard", (c) =>
    c.types.includes("public.png") && (c.pngBytes ?? 0) > 0 ? c : null,
  );

  void ctx.mark("clipboard: copy svg");
  await clearClipboard(ctx);
  const svg = await ctx.withSvgCsp(async () => {
    dialogButton(modal, "Copy SVG").click();
    return waitClipboard(ctx, "SVG on the clipboard", (c) =>
      c.svgText?.includes("<svg") && !c.svgText.includes("smoke-sentinel")
        ? c
        : null,
    );
  });
  const svgText = svg.value.svgText ?? "";
  const colours = svgColours(svgText);
  const themed = colours.filter((c) => ctx.themeColours.has(c));
  if (themed.length || !colours.includes("#1e1e1e")) {
    throw new Error(
      `Clipboard SVG colours ${JSON.stringify(
        colours,
      )} (themed ${JSON.stringify(
        themed,
      )}), expected the drawing's #1e1e1e and no theme colours`,
    );
  }
  await closeDialog(ctx);

  // Context menu "Copy to clipboard as PNG" takes the same path.
  void ctx.mark("clipboard: context menu");
  await clearClipboard(ctx);
  const canvas = ctx.root.querySelector<HTMLElement>(
    ".vault-editor canvas.interactive",
  );
  if (!canvas) {
    throw new Error("Interactive canvas missing");
  }
  const rect = canvas.getBoundingClientRect();
  canvas.dispatchEvent(
    new ctx.win.MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      clientX: rect.left + 40,
      clientY: rect.top + 60,
      button: 2,
    }),
  );
  const item = await ctx.waitFor("context menu copy as PNG", () =>
    Array.from(
      ctx.doc.querySelectorAll<HTMLElement>(".context-menu-item"),
    ).find((el) => el.textContent?.includes("Copy to clipboard as PNG")),
  );
  item.click();
  const ctxPng = await waitClipboard(ctx, "context-menu PNG", (c) =>
    c.types.includes("public.png") && (c.pngBytes ?? 0) > 0 ? c : null,
  );
  return {
    clipboardTypesAfterPng: png.value.types,
    pngBytes: png.value.pngBytes,
    pngCopyMs: png.ms,
    fileExportBytes: fileExport.bytes.length,
    pngMatchesFileExport: png.value.pngBytes === fileExport.bytes.length,
    clipboardTypesAfterSvg: svg.value.types,
    svgBytes: svgText.length,
    svgCopyMs: svg.ms,
    svgColours: colours,
    contextMenuPngBytes: ctxPng.value.pngBytes,
    contextMenuPngTypes: ctxPng.value.types,
  };
};

/** c. Mermaid dialog works offline: no non-local requests, inserts elements. */
export const mermaidOfflineStep = async (ctx: ExportSmokeContext) => {
  const stopWatching = watchResources(ctx.win);
  const restoreMermaidText = snapshotMermaidText(ctx.win);
  try {
    const before = await countLive(ctx);
    const opened = ctx.win.performance.now();
    const item = await menuItem(
      ctx,
      "Insert Mermaid diagram",
      (el) => !!el.textContent?.includes("Insert Mermaid diagram"),
    );
    item.click();
    const dialog = await ctx.waitFor("Mermaid dialog", () =>
      ctx.doc.querySelector<HTMLElement>(".ttd-dialog"),
    );
    const triggers = Array.from(
      dialog.querySelectorAll<HTMLElement>('[role="tab"]'),
    ).map((t) => t.textContent?.trim());
    if (triggers.length || dialog.textContent?.includes("Text to diagram")) {
      throw new Error(`Mermaid dialog shows tabs ${JSON.stringify(triggers)}`);
    }
    if (!dialog.textContent?.includes("Mermaid to Excalidraw")) {
      throw new Error("Mermaid dialog title missing");
    }
    await ctx.waitFor(
      "Mermaid preview",
      () =>
        dialog.querySelector(".ttd-dialog-output-canvas-content canvas") ??
        (dialog.querySelector('[data-testid="ttd-dialog-output-error"]')
          ? (() => {
              throw new Error(
                `Mermaid preview error: ${
                  dialog.querySelector(".ttd-dialog-output-error-message")
                    ?.textContent
                }`,
              );
            })()
          : null),
      20_000,
    );
    const previewMs = round(ctx.win.performance.now() - opened);
    const insert = Array.from(dialog.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "Insert",
    );
    if (!insert) {
      throw new Error("Insert button missing");
    }
    insert.click();
    await ctx.waitFor("Mermaid dialog closed", () =>
      ctx.doc.querySelector(".ttd-dialog") ? null : true,
    );
    let after = before;
    const until = ctx.win.performance.now() + 8000;
    while (after <= before && ctx.win.performance.now() < until) {
      await ctx.delay(250);
      after = await countLive(ctx);
    }
    if (after <= before) {
      throw new Error(`Element count did not grow (${before} -> ${after})`);
    }
    const resources = stopWatching();
    if (resources.nonLocal.length) {
      throw new Error(`Non-local requests: ${resources.nonLocal.join(", ")}`);
    }
    return {
      tabs: triggers,
      previewReadyMs: previewMs,
      elementsBefore: before,
      elementsAfter: after,
      resourceRequests: resources.requests,
      nonLocalRequests: 0,
      sampleRequests: resources.sample,
    };
  } finally {
    stopWatching();
    await closeDialog(ctx).catch(() => {});
    restoreMermaidText();
  }
};

// ----------------------------------------------------------------- perf step

const makeScene = (elementCount: number) => {
  const columns = 32;
  return convertToExcalidrawElements(
    Array.from({ length: Math.ceil(elementCount / 2) }, (_, i) => ({
      type: "rectangle" as const,
      x: (i % columns) * 110,
      y: Math.floor(i / columns) * 60,
      width: 100,
      height: 50,
      label: { text: `N${i}`, fontSize: 12 },
    })),
  );
};

const flowchart = (nodes: number) => {
  const lines = ["flowchart TD"];
  for (let i = 1; i < nodes; i += 1) {
    const parent = Math.floor((i - 1) / 2);
    lines.push(`  N${parent}[Node ${parent}] --> N${i}[Node ${i}]`);
  }
  return lines.join("\n");
};

/** d. numbers only; fails only if something takes absurdly long. */
export const perfExportMermaidStep = async (ctx: ExportSmokeContext) => {
  const stopWatching = watchResources(ctx.win);
  const result: Record<string, unknown> = {};
  const slow: string[] = [];
  const note = (label: string, ms: number) => {
    if (ms > ABSURD_MS) {
      slow.push(`${label}=${Math.round(ms)}ms`);
    }
  };
  const now = () => ctx.win.performance.now();
  const runId = Math.floor(ctx.win.Date.now()).toString(36);

  const request = (
    type: ImageExportRequest["type"],
    elements: ReturnType<typeof makeScene>,
    scale: 1 | 2 | 3,
  ): ImageExportRequest => ({
    type,
    elements: elements as unknown as ImageExportRequest["elements"],
    appState: {
      ...getDefaultAppState(),
      exportScale: scale,
      exportBackground: true,
      exportEmbedScene: false,
      exportWithDarkMode: false,
      exportSelectionOnly: false,
    } as unknown as ImageExportRequest["appState"],
    files: {},
    exportingFrame: null,
    name: "perf",
  });

  const scenes = {
    small: makeScene(20),
    large: makeScene(1000),
  };
  result.sceneElements = {
    small: scenes.small.length,
    large: scenes.large.length,
  };

  // Export: render (standard colours) + native write, 3 runs each.
  const exportCase = async (
    label: string,
    type: ImageExportRequest["type"],
    scene: ReturnType<typeof makeScene>,
    scale: 1 | 2 | 3,
    runs: number,
  ) => {
    void ctx.mark(`perf ${label}`);
    const renders: number[] = [];
    const ipcs: number[] = [];
    let bytes = 0;
    for (let i = 0; i < runs; i += 1) {
      const t0 = now();
      const run = () => renderImageExport(request(type, scene, scale), ctx.win);
      const image = await (type === "svg" ? ctx.withSvgCsp(run) : run());
      const t1 = now();
      exportCounter += 1;
      const written = await desktopRepository.exportFile(
        `perf-${runId}-${exportCounter}-${image.fileName}`,
        image.bytes,
      );
      const t2 = now();
      if (!written) {
        throw new Error(`${label}: native export was cancelled`);
      }
      renders.push(t1 - t0);
      ipcs.push(t2 - t1);
      bytes = image.bytes.length;
    }
    note(`${label} render`, median(renders));
    note(`${label} ipc`, median(ipcs));
    result[label] = {
      renderMs: round(median(renders)),
      ipcMs: round(median(ipcs)),
      totalMs: round(median(renders) + median(ipcs)),
      firstRenderMs: round(renders[0]),
      bytes,
      runs,
    };
  };
  await exportCase("small-png-1x", "png", scenes.small, 1, 3);
  await exportCase("small-svg", "svg", scenes.small, 1, 3);
  await exportCase("large-png-1x", "png", scenes.large, 1, 3);
  await exportCase("large-png-3x", "png", scenes.large, 3, 2);
  await exportCase("large-svg", "svg", scenes.large, 1, 3);

  // Clipboard: render + native pasteboard, end to end and IPC alone.
  const clipboardCase = async (
    label: string,
    type: "clipboard" | "clipboard-svg",
    scene: ReturnType<typeof makeScene>,
  ) => {
    void ctx.mark(`perf ${label}`);
    const totals: number[] = [];
    const ipcs: number[] = [];
    for (let i = 0; i < 3; i += 1) {
      const t0 = now();
      const run = () => renderImageExport(request(type, scene, 1), ctx.win);
      const image = await (type === "clipboard-svg"
        ? ctx.withSvgCsp(run)
        : run());
      const t1 = now();
      void ctx.mark(`perf ${label} rendered ${image.bytes.length} B`);
      await copyToClipboard(
        type === "clipboard" ? "png" : "svg",
        image.bytes,
        ctx.win,
      );
      const t2 = now();
      totals.push(t2 - t0);
      ipcs.push(t2 - t1);
    }
    note(`${label} total`, median(totals));
    result[label] = {
      totalMs: round(median(totals)),
      ipcMs: round(median(ipcs)),
    };
  };
  await clipboardCase("clipboard-large-png-1x", "clipboard", scenes.large);
  await clipboardCase("clipboard-large-svg", "clipboard-svg", scenes.large);
  await clipboardCase("clipboard-small-png-1x", "clipboard", scenes.small);

  // Mermaid conversion straight through the package's library.
  void ctx.mark("perf mermaid library import");
  const lib = await import("@excalidraw/mermaid-to-excalidraw");
  const mermaid: Record<string, unknown> = {};
  for (const nodes of [10, 50, 200, 500]) {
    void ctx.mark(`perf mermaid ${nodes} nodes`);
    const definition = flowchart(nodes);
    const stopBeat = startHeartbeat(ctx.win);
    const t0 = now();
    const parsed = await lib.parseMermaidToExcalidraw(definition);
    const t1 = now();
    const elements = convertToExcalidrawElements(parsed.elements, {
      regenerateIds: true,
    });
    const t2 = now();
    const beat = stopBeat();
    note(`mermaid ${nodes}`, t2 - t0);
    mermaid[`${nodes}-nodes`] = {
      parseMs: round(t1 - t0),
      convertMs: round(t2 - t1),
      totalMs: round(t2 - t0),
      elements: elements.length,
      longestBlockMs: beat.maxGapMs,
      heartbeatTicks: beat.ticks,
    };
  }
  result.mermaidLibrary = mermaid;

  // Mermaid through the real dialog (typing -> preview), UI latency.
  void ctx.mark("perf mermaid dialog");
  const restoreMermaidText = snapshotMermaidText(ctx.win);
  const dialogResult: Record<string, unknown> = {};
  try {
    const item = await menuItem(
      ctx,
      "Insert Mermaid diagram",
      (el) => !!el.textContent?.includes("Insert Mermaid diagram"),
    );
    item.click();
    const dialog = await ctx.waitFor("Mermaid dialog", () =>
      ctx.doc.querySelector<HTMLElement>(".ttd-dialog"),
    );
    // CodeMirror 6 is a lazy chunk; the textarea only exists as a fallback.
    const editor = await ctx.waitFor("Mermaid editor", () =>
      dialog.querySelector<HTMLElement>(
        ".cm-content, textarea.ttd-dialog-input",
      ),
    );
    const { EditorView } = await import("@codemirror/view");
    const setText = (text: string) => {
      const view = EditorView.findFromDOM(editor);
      if (view) {
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: text },
        });
        return;
      }
      Object.getOwnPropertyDescriptor(
        ctx.win.HTMLTextAreaElement.prototype,
        "value",
      )?.set?.call(editor, text);
      editor.dispatchEvent(new ctx.win.Event("input", { bubbles: true }));
    };
    const previewCanvas = () =>
      dialog.querySelector(".ttd-dialog-output-canvas-content canvas");
    await ctx.waitFor("initial preview", previewCanvas, 20_000);
    for (const nodes of [50, 200]) {
      const before = previewCanvas();
      const stopBeat = startHeartbeat(ctx.win);
      const t0 = now();
      setText(flowchart(nodes));
      await ctx.waitFor(
        `preview for ${nodes} nodes`,
        () => {
          const c = previewCanvas();
          return c && c !== before ? c : null;
        },
        60_000,
      );
      const ms = now() - t0;
      const beat = stopBeat();
      note(`mermaid dialog ${nodes}`, ms);
      dialogResult[`${nodes}-nodes`] = {
        typeToPreviewMs: round(ms),
        includesDebounceMs: 300,
        longestBlockMs: beat.maxGapMs,
      };
    }
  } finally {
    await closeDialog(ctx).catch(() => {});
    restoreMermaidText();
  }
  result.mermaidDialog = dialogResult;

  const resources = stopWatching();
  result.resources = {
    requests: resources.requests,
    nonLocal: resources.nonLocal,
  };
  if (resources.nonLocal.length) {
    throw new Error(`Non-local requests: ${resources.nonLocal.join(", ")}`);
  }
  if (slow.length) {
    throw new Error(`Absurdly slow (> ${ABSURD_MS} ms): ${slow.join(", ")}`);
  }
  return result;
};
