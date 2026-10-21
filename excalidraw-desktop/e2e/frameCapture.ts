import { deflateSync } from "node:zlib";

import { sceneJson } from "./tabsHelpers";

import type { Browser, CDPSession, Page } from "@playwright/test";

// Frame-capture toolkit for the "smooth tab switching" proof (tabsSmooth.spec.ts).
//  - CDP Page.startScreencast records every composited frame (Chromium only);
//  - an in-page requestAnimationFrame probe records opacity, toolbar, loading
//    message and canvas count on every frame (any engine);
//  - frames are decoded in a throwaway page (no pngjs/jpeg dependency) into a
//    small RGB grid of the editor pane and compared with the A / B references.

export const GRID_W = 128;
export const GRID_H = 80;
const CELL = 4; // local-diff cells are CELL x CELL grid pixels (~40 px on screen)

/** Calibrated in tabsSmooth.spec.ts (see personal/feature/tabs-phase3/smooth). */
export const MEAN_T = 1.5; // mean abs diff over the whole pane, 0..255
export const LOCAL_T = 12; // worst CELL x CELL block mean abs diff

// ---- fixtures -----------------------------------------------------------------------------

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return c >>> 0;
});
const crc32 = (buf: Buffer) => {
  let c = 0xffffffff;
  for (const b of buf) {
    c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type: string, data: Buffer) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};
/** A noisy RGB PNG data URL, `w` x `h`; `tint` biases the colour. */
const noisePng = (w: number, h: number, seed: number, tint: number[]) => {
  let s = seed;
  const rows: Buffer[] = [];
  for (let y = 0; y < h; y++) {
    const row = Buffer.alloc(1 + w * 3);
    for (let x = 0; x < w; x++) {
      for (let c = 0; c < 3; c++) {
        s = (s * 1664525 + 1013904223) >>> 0;
        row[1 + x * 3 + c] = Math.min(255, (s >>> 25) + tint[c]);
      }
    }
    rows.push(row);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(Buffer.concat(rows))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
  return `data:image/png;base64,${png.toString("base64")}`;
};

const baseEl = {
  angle: 0,
  strokeColor: "#1e1e1e",
  backgroundColor: "transparent",
  fillStyle: "solid",
  strokeWidth: 2,
  strokeStyle: "solid",
  roughness: 0,
  opacity: 100,
  groupIds: [],
  frameId: null,
  roundness: null,
  boundElements: [],
  link: null,
  locked: false,
  isDeleted: false,
  version: 1,
  versionNonce: 1,
  index: null,
  updated: 1,
};

/** Two scenes that differ over most of the pane: big coloured shapes, text in a
 * non-default font (6 Nunito / 8 Comic Shanns) and one embedded image. */
const bigScene = (o: {
  prefix: string;
  fill: string;
  fill2: string;
  type: "rectangle" | "ellipse";
  font: number;
  text: string;
  tint: number[];
  seed: number;
}) => {
  const id = (s: string) => `${o.prefix}-${s}`;
  const shape = (
    s: string,
    type: string,
    x: number,
    y: number,
    w: number,
    h: number,
    bg: string,
    i: number,
  ) => ({
    ...baseEl,
    id: id(s),
    type,
    x,
    y,
    width: w,
    height: h,
    backgroundColor: bg,
    strokeColor: "#222222",
    seed: o.seed + i,
    roundness: null,
  });
  const text = {
    ...baseEl,
    id: id("text"),
    type: "text",
    x: 90,
    y: 90,
    width: 420,
    height: 100,
    text: o.text,
    originalText: o.text,
    fontSize: 36,
    fontFamily: o.font,
    textAlign: "left",
    verticalAlign: "top",
    containerId: null,
    lineHeight: 1.25,
    autoResize: true,
    seed: o.seed + 9,
  };
  const image = {
    ...baseEl,
    id: id("img"),
    type: "image",
    x: 80,
    y: 380,
    width: 300,
    height: 200,
    fileId: id("file"),
    status: "saved",
    scale: [1, 1],
    seed: o.seed + 10,
  };
  const files = {
    [id("file")]: {
      mimeType: "image/png",
      id: id("file"),
      dataURL: noisePng(150, 100, o.seed, o.tint),
      created: 1700000000000,
    },
  };
  return sceneJson(
    [],
    [
      shape("big", o.type, 40, 40, 620, 340, o.fill, 1),
      shape("big2", o.type, 420, 300, 320, 320, o.fill2, 2),
      shape("big3", "rectangle", 20, 640, 700, 140, o.fill2, 3),
      text,
      image,
    ],
    files,
  );
};

export const SCENE_A = bigScene({
  prefix: "sa",
  fill: "#ffa8a8",
  fill2: "#a5d8ff",
  type: "rectangle",
  font: 6,
  text: "Alpha drawing\nNunito text",
  tint: [90, 0, 0],
  seed: 11,
});
export const SCENE_B = bigScene({
  prefix: "sb",
  fill: "#8ce99a",
  fill2: "#ffd43b",
  type: "ellipse",
  font: 8,
  text: "Beta sketch\nComic Shanns",
  tint: [0, 0, 120],
  seed: 77,
});

// ---- screencast ---------------------------------------------------------------------------

export type RawFrame = { t: number; data: string };

export const startScreencast = async (cdp: CDPSession, page: Page) => {
  const frames: RawFrame[] = [];
  let on = true;
  cdp.on("Page.screencastFrame", (e) => {
    if (on) {
      frames.push({ t: e.metadata.timestamp! * 1000, data: e.data });
    }
    void cdp.send("Page.screencastFrameAck", { sessionId: e.sessionId });
  });
  const vp = page.viewportSize()!;
  await cdp.send("Page.startScreencast", {
    format: "jpeg",
    quality: 90,
    maxWidth: vp.width,
    maxHeight: vp.height,
    everyNthFrame: 1,
  });
  return {
    frames,
    stop: async () => {
      on = false;
      await cdp.send("Page.stopScreencast");
    },
  };
};

/** One settled screenshot through the same JPEG pipeline (a reference). */
export const captureRef = async (cdp: CDPSession): Promise<RawFrame> => ({
  t: Date.now(),
  data: (
    await cdp.send("Page.captureScreenshot", { format: "jpeg", quality: 90 })
  ).data,
});

// ---- in-page probe ------------------------------------------------------------------------

export type ProbeSample = {
  t: number; // epoch ms
  minOpacity: number;
  toolbar: boolean;
  loading: boolean;
  canvases: number;
  /** Elements in the shown editor's scene (null when the e2e hook is missing). */
  elements: number | null;
};

export const installFrameProbe = (page: Page) =>
  page.evaluate(() => {
    const w = window as any;
    if (w.__fp) {
      return;
    }
    w.__fp = { t0: 0, samples: [] as unknown[], running: false };
    const stamp = () => {
      w.__fp.t0 = performance.timeOrigin + performance.now();
    };
    document.addEventListener("click", stamp, true);
    document.addEventListener("keydown", stamp, true);
    const sample = () => {
      const container = document.querySelector(
        ".vault-editor-container",
      ) as HTMLElement | null;
      let minOpacity = 1;
      let n: HTMLElement | null = container;
      while (n) {
        minOpacity = Math.min(minOpacity, +getComputedStyle(n).opacity);
        n = n.parentElement;
      }
      const tb = container?.querySelector(
        '[data-testid="toolbar-rectangle"]',
      ) as HTMLElement | null;
      const r = tb?.getBoundingClientRect();
      const toolbar = Boolean(
        tb &&
          r &&
          r.width > 0 &&
          r.height > 0 &&
          getComputedStyle(tb).visibility !== "hidden",
      );
      return {
        t: performance.timeOrigin + performance.now(),
        minOpacity: +minOpacity.toFixed(3),
        toolbar,
        loading: Boolean(document.querySelector(".LoadingMessage")),
        canvases: container ? container.querySelectorAll("canvas").length : 0,
        elements:
          typeof w.__editorApis === "function"
            ? w.__editorApis()[0]?.getSceneElements().length ?? 0
            : null,
      };
    };
    w.__sampleNow = sample;
    /** Samples on every animation frame for `ms`, starting now. */
    w.__startProbe = (ms: number) => {
      w.__fp.samples = [];
      const end = performance.now() + ms;
      const tick = () => {
        w.__fp.samples.push(sample());
        if (performance.now() < end) {
          requestAnimationFrame(tick);
        }
      };
      requestAnimationFrame(tick);
    };
  });

export const startProbe = (page: Page, ms: number) =>
  page.evaluate((m) => (window as any).__startProbe(m), ms);

export const readProbe = (page: Page) =>
  page.evaluate(() => ({
    t0: (window as any).__fp.t0 as number,
    samples: (window as any).__fp.samples as ProbeSample[],
  }));

export const settledShape = (page: Page): Promise<ProbeSample> =>
  page.evaluate(() => (window as any).__sampleNow());

/** What a healthy frame looks like: not dimmed, toolbar there, no loading
 * message, at least as many canvases as the settled editor has. */
export const probeViolations = (s: ProbeSample[], settled: ProbeSample) => {
  const bad: string[] = [];
  for (const p of s) {
    if (p.minOpacity < 1) {
      bad.push(`dimmed(${p.minOpacity})`);
    }
    if (!p.toolbar) {
      bad.push("no-toolbar");
    }
    if (p.loading) {
      bad.push("loading-message");
    }
    if (p.elements !== null && p.elements === 0) {
      bad.push("empty-scene");
    }
    if (p.canvases < settled.canvases) {
      bad.push(`canvases(${p.canvases}<${settled.canvases})`);
    }
  }
  return bad;
};

// ---- decoding and classification ---------------------------------------------------------

export type Region = { x: number; y: number; width: number; height: number };
export type Grid = number[]; // GRID_W * GRID_H * 3

/** Decodes JPEG frames in a throwaway page into RGB grids of `region` (fractions of the viewport). */
export const decodeFrames = async (
  browser: Browser,
  frames: RawFrame[],
  region: Region,
  viewport: { width: number; height: number },
): Promise<Grid[]> => {
  const ctx = await browser.newContext();
  const dec = await ctx.newPage();
  try {
    const out: Grid[] = [];
    const BATCH = 40;
    for (let i = 0; i < frames.length; i += BATCH) {
      const part = frames.slice(i, i + BATCH).map((f) => f.data);
      out.push(
        ...(await dec.evaluate(
          async ([datas, reg, vp, gw, gh]) => {
            const res: number[][] = [];
            const cv = document.createElement("canvas");
            cv.width = gw as number;
            cv.height = gh as number;
            const c = cv.getContext("2d", { willReadFrequently: true })!;
            const r = reg as Region;
            const v = vp as { width: number; height: number };
            for (const d of datas as string[]) {
              const bin = atob(d);
              const bytes = new Uint8Array(bin.length);
              for (let k = 0; k < bin.length; k++) {
                bytes[k] = bin.charCodeAt(k);
              }
              const bmp = await createImageBitmap(
                new Blob([bytes], { type: "image/jpeg" }),
              );
              const sx = (r.x / v.width) * bmp.width;
              const sy = (r.y / v.height) * bmp.height;
              const sw = (r.width / v.width) * bmp.width;
              const sh = (r.height / v.height) * bmp.height;
              c.drawImage(
                bmp,
                sx,
                sy,
                sw,
                sh,
                0,
                0,
                gw as number,
                gh as number,
              );
              const px = c.getImageData(0, 0, gw as number, gh as number).data;
              const g: number[] = [];
              for (let k = 0; k < px.length; k += 4) {
                g.push(px[k], px[k + 1], px[k + 2]);
              }
              res.push(g);
              bmp.close();
            }
            return res;
          },
          [part, region, viewport, GRID_W, GRID_H] as const,
        )),
      );
    }
    return out;
  } finally {
    await ctx.close();
  }
};

export type Dist = { mean: number; local: number };

export const dist = (a: Grid, b: Grid): Dist => {
  let sum = 0;
  const bw = GRID_W / CELL;
  const bh = GRID_H / CELL;
  const blocks = new Array<number>(bw * bh).fill(0);
  for (let y = 0; y < GRID_H; y++) {
    for (let x = 0; x < GRID_W; x++) {
      const i = (y * GRID_W + x) * 3;
      const d =
        (Math.abs(a[i] - b[i]) +
          Math.abs(a[i + 1] - b[i + 1]) +
          Math.abs(a[i + 2] - b[i + 2])) /
        3;
      sum += d;
      blocks[Math.floor(y / CELL) * bw + Math.floor(x / CELL)] += d;
    }
  }
  return {
    mean: sum / (GRID_W * GRID_H),
    local: Math.max(...blocks) / (CELL * CELL),
  };
};

export type Kind = "A" | "B" | "other";

export const classify = (g: Grid, refA: Grid, refB: Grid) => {
  const da = dist(g, refA);
  const db = dist(g, refB);
  const isA = da.mean < MEAN_T && da.local < LOCAL_T;
  const isB = db.mean < MEAN_T && db.local < LOCAL_T;
  const kind: Kind = isB ? "B" : isA ? "A" : "other";
  return { kind, da, db };
};

export const pct = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.max(0, Math.ceil(p * s.length) - 1)];
};
