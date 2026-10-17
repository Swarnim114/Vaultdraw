import { expect, type CDPSession, type Page } from "@playwright/test";

import { canvasBox, openDrawing, openVault } from "./helpers";

const FONT_SIZE = 28;

const base = {
  angle: 0,
  strokeColor: "#1e1e1e",
  backgroundColor: "transparent",
  fillStyle: "solid",
  strokeWidth: 1,
  strokeStyle: "solid",
  roughness: 1,
  opacity: 100,
  groupIds: [],
  roundness: null,
  locked: false,
  frameId: null,
  isDeleted: false,
};

export const textElement = (
  id: string,
  text: string,
  x: number,
  y: number,
) => ({
  ...base,
  id,
  type: "text",
  x,
  y,
  width: Math.ceil(text.length * FONT_SIZE * 0.6),
  height: Math.ceil(FONT_SIZE * 1.25),
  text,
  originalText: text,
  fontSize: FONT_SIZE,
  fontFamily: 1,
  textAlign: "left",
  verticalAlign: "top",
  containerId: null,
  lineHeight: 1.25,
  link: null,
  boundElements: [],
});

const sceneJson = (elements: object[]) =>
  JSON.stringify({
    type: "excalidraw",
    version: 2,
    source: "e2e-link-styling",
    elements,
    appState: {},
    files: {},
  });

/** A drawing with some shapes, so its preview thumbnail is not empty. */
export const notesScene = () =>
  sceneJson([
    {
      ...base,
      id: "notes-rect",
      type: "rectangle",
      x: 0,
      y: 0,
      width: 160,
      height: 90,
    },
    textElement("notes-t", "notes body", 20, 20),
  ]);

/** Seeds drawings into the fake vault of an open page and lets the index see them. */
export const seedDrawings = async (
  page: Page,
  drawings: Record<string, string>,
) => {
  await page.evaluate((files) => {
    const w = window as any;
    const repo = w.__vaultRepo;
    for (const [path, json] of Object.entries(files)) {
      repo.seedDrawing(path, json);
    }
    repo.emit({ handle: repo.handle, paths: [], rescan: true });
  }, drawings);
  for (const path of Object.keys(drawings)) {
    const name = path.replace(/\.excalidraw$/, "");
    await expect(
      page.locator(".vault-tree-item__name", { hasText: name }).first(),
    ).toBeVisible();
  }
  await page.evaluate(() => (window as any).__vaultLinks.settled());
};

export const openSeeded = async (
  page: Page,
  drawings: Record<string, string>,
  open: string,
) => {
  await openVault(page, "?seed=empty");
  await seedDrawings(page, drawings);
  await openDrawing(page, open);
};

export const palette = (page: Page) =>
  page.getByRole("dialog", { name: "Command palette" });

export const runCommand = async (page: Page, title: string) => {
  await page.keyboard.press("Meta+Shift+p");
  await expect(palette(page)).toBeVisible();
  await page.keyboard.type(title);
  await page.keyboard.press("Enter");
  await expect(palette(page)).toHaveCount(0);
};

export type Scan = {
  w: number;
  h: number;
  dpr: number;
  /** Count of saturated (link-coloured) pixels per column / row. */
  cols: number[];
  rows: number[];
  saturated: number;
  /** Near-black low-chroma pixels (plain stroke colour). */
  dark: number;
  maxChroma: number;
  /** Hue (deg) of the most saturated pixel. */
  hue: number;
};

/** Reads the static canvas and classifies pixels (saturated = link colour). */
export const scanCanvas = (page: Page): Promise<Scan> =>
  page.evaluate(() => {
    const c = document.querySelector<HTMLCanvasElement>(
      ".vault-editor canvas.static",
    )!;
    const { width: w, height: h } = c;
    const d = c.getContext("2d")!.getImageData(0, 0, w, h).data;
    const cols = new Array<number>(w).fill(0);
    const rows = new Array<number>(h).fill(0);
    let saturated = 0;
    let dark = 0;
    let maxChroma = 0;
    let hue = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const r = d[i];
        const g = d[i + 1];
        const b = d[i + 2];
        const hi = Math.max(r, g, b);
        const lo = Math.min(r, g, b);
        const chroma = hi - lo;
        if (chroma > 25) {
          saturated++;
          cols[x]++;
          rows[y]++;
          if (chroma > maxChroma) {
            maxChroma = chroma;
            const delta = chroma;
            let hh: number;
            if (hi === r) {
              hh = ((g - b) / delta) % 6;
            } else if (hi === g) {
              hh = (b - r) / delta + 2;
            } else {
              hh = (r - g) / delta + 4;
            }
            hue = (hh * 60 + 360) % 360;
          }
        } else if (hi < 90) {
          dark++;
        }
      }
    }
    return {
      w,
      h,
      dpr: window.devicePixelRatio,
      cols,
      rows,
      saturated,
      dark,
      maxChroma,
      hue,
    };
  });

export type Cluster = { x0: number; x1: number; pixels: number };

/** Groups saturated columns into clusters separated by wide gaps (css px). */
export const clusters = (scan: Scan, gapCss = 25): Cluster[] => {
  const gap = gapCss * scan.dpr;
  const out: Cluster[] = [];
  let cur: Cluster | null = null;
  for (let x = 0; x < scan.cols.length; x++) {
    if (!scan.cols[x]) {
      continue;
    }
    if (cur && x - cur.x1 <= gap) {
      cur.x1 = x;
      cur.pixels += scan.cols[x];
    } else {
      cur = { x0: x, x1: x, pixels: scan.cols[x] };
      out.push(cur);
    }
  }
  return out;
};

/** Per-cluster stats from the pixel rows within its columns. */
export const clusterStats = (
  page: Page,
  cluster: Cluster,
): Promise<{
  maxChroma: number;
  underlineRun: number;
  underlineY: number;
  topY: number;
}> =>
  page.evaluate(({ x0, x1 }) => {
    const c = document.querySelector<HTMLCanvasElement>(
      ".vault-editor canvas.static",
    )!;
    const { width: w, height: h } = c;
    const d = c.getContext("2d")!.getImageData(0, 0, w, h).data;
    let maxChroma = 0;
    let topY = h;
    let underlineY = 0;
    const width = x1 - x0 + 1;
    const sat = (x: number, y: number) => {
      const i = (y * w + x) * 4;
      return (
        Math.max(d[i], d[i + 1], d[i + 2]) -
          Math.min(d[i], d[i + 1], d[i + 2]) >
        25
      );
    };
    for (let y = 0; y < h; y++) {
      let n = 0;
      for (let x = x0; x <= x1; x++) {
        if (sat(x, y)) {
          n++;
          topY = Math.min(topY, y);
          const i = (y * w + x) * 4;
          maxChroma = Math.max(
            maxChroma,
            Math.max(d[i], d[i + 1], d[i + 2]) -
              Math.min(d[i], d[i + 1], d[i + 2]),
          );
        }
      }
      // the underline is the bottom-most row with a long link-coloured run
      if (n >= width * 0.2) {
        underlineY = y;
      }
    }
    // longest contiguous run in the underline band (solid: the name, dashed: a dash)
    let underlineRun = 0;
    for (let y = underlineY - 1; y <= underlineY + 1; y++) {
      let run = 0;
      for (let x = x0; x <= x1; x++) {
        run = sat(x, y) ? run + 1 : 0;
        underlineRun = Math.max(underlineRun, run);
      }
    }
    return { maxChroma, underlineRun, underlineY, topY };
  }, cluster);

/** Viewport point (css px) of a canvas pixel. */
export const viewportPoint = async (
  page: Page,
  scan: Scan,
  px: number,
  py: number,
) => {
  const box = await canvasBox(page);
  return { x: box.x + px / scan.dpr, y: box.y + py / scan.dpr };
};

export const sessions = new WeakMap<Page, CDPSession>();
/** CDP CPU throttle (Chromium only); the session stays open. */
export const throttle = async (
  page: Page,
  browserName: string,
  rate: number,
) => {
  if (browserName !== "chromium") {
    return;
  }
  let cdp = sessions.get(page);
  if (!cdp) {
    cdp = await page.context().newCDPSession(page);
    sessions.set(page, cdp);
  }
  await cdp.send("Emulation.setCPUThrottlingRate", { rate });
};

export const TOGGLE_STYLING = "Links: Toggle link styling";

/** Toggles link styling through the palette (Cmd+Shift+P). */
export const toggleStyling = (page: Page) => runCommand(page, TOGGLE_STYLING);
