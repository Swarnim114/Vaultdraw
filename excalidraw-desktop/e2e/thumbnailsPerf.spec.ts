/* eslint-disable no-console */
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { deflateSync } from "node:zlib";

import { expect, test } from "@playwright/test";
import { build } from "vite";

import type { Page } from "@playwright/test";
import type { Step0Hooks } from "./thumbnailsStep0";

// F2 thumbnails, step 0 (gate before the gallery/surfaces): main-thread cost of
// renderScenePng (exportToCanvas + toBlob PNG, 384 px) for 100/500/1500 element
// scenes (rough default roughness and roughness 0) plus a scene with an
// embedded image, at 1x and (Chromium only) 4x CPU throttle. One
// `THUMB_STEP0 {json}` line per case (record.mjs spec ingests `<NAME>_PERF`).
//
//   E2E_PERF=1 E2E_FULL=1 npx playwright test e2e/thumbnailsPerf.spec.ts
//
// The measurement page (e2e/thumbnailsStep0.html) is production-built here with
// the e2e vite config and served through page.route under /__step0/.
const PERF = process.env.E2E_PERF === "1" || process.env.THUMB_PERF === "1";
const RUNS = Number(process.env.THUMB_RUNS ?? 30);
const WARMUP = 3;
const SIZES = [100, 500, 1500];

test.skip(!PERF, "set E2E_PERF=1 to run the thumbnail render measurements");
test.describe.configure({ timeout: 600_000 });

const desktopDir = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "..",
);
const outDir = path.join(os.tmpdir(), `vaultdraw-step0-${process.pid}`);
const MIME: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".woff2": "font/woff2",
  ".wasm": "application/wasm",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

// --- scene generation (deterministic, mixed element types)

let seed = 12345;
const rnd = () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};
const base = (id: string, type: string, rough: number) => ({
  id,
  type,
  x: Math.round(rnd() * 3000),
  y: Math.round(rnd() * 2000),
  width: 40 + Math.round(rnd() * 160),
  height: 30 + Math.round(rnd() * 120),
  angle: 0,
  strokeColor: ["#1e1e1e", "#e03131", "#2f9e44", "#1971c2"][
    Math.floor(rnd() * 4)
  ],
  backgroundColor: rnd() < 0.5 ? "transparent" : "#ffc9c9",
  fillStyle: "hachure",
  strokeWidth: 2,
  strokeStyle: "solid",
  roughness: rough,
  opacity: 100,
  groupIds: [],
  frameId: null,
  roundness: null,
  seed: Math.floor(rnd() * 2 ** 31),
  version: 1,
  versionNonce: Math.floor(rnd() * 2 ** 31),
  isDeleted: false,
  boundElements: null,
  updated: 1,
  link: null,
  locked: false,
});

const element = (i: number, rough: number) => {
  const r = rnd();
  const id = `el${i}`;
  if (r < 0.5) {
    return base(id, ["rectangle", "ellipse", "diamond"][i % 3], rough);
  }
  if (r < 0.75) {
    return {
      ...base(id, "text", rough),
      text: `Node ${i}`,
      originalText: `Node ${i}`,
      fontSize: 20,
      fontFamily: 5,
      textAlign: "left",
      verticalAlign: "top",
      containerId: null,
      autoResize: true,
      lineHeight: 1.25,
      backgroundColor: "transparent",
    };
  }
  const b = base(id, "arrow", rough);
  return {
    ...b,
    points: [
      [0, 0],
      [b.width / 2, b.height / 3],
      [b.width, b.height],
    ],
    lastCommittedPoint: null,
    startBinding: null,
    endBinding: null,
    startArrowhead: null,
    endArrowhead: "arrow",
    elbowed: false,
  };
};

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
/** A size x size RGB gradient with mild noise (so it does not compress to nothing). */
const pngDataUrl = (size: number) => {
  const raw = Buffer.alloc((size * 3 + 1) * size);
  let o = 0;
  for (let y = 0; y < size; y++) {
    raw[o++] = 0;
    for (let x = 0; x < size; x++) {
      raw[o++] = (x * 255) / size;
      raw[o++] = (y * 255) / size;
      raw[o++] = Math.floor(rnd() * 64);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
  return `data:image/png;base64,${png.toString("base64")}`;
};

const scene = (n: number, rough: number, withImage = false) => {
  const elements: unknown[] = Array.from({ length: n }, (_, i) =>
    element(i, rough),
  );
  const files: Record<string, unknown> = {};
  if (withImage) {
    elements.push({
      ...base("img1", "image", rough),
      width: 600,
      height: 600,
      fileId: "file1",
      status: "saved",
      scale: [1, 1],
      crop: null,
    });
    files.file1 = {
      id: "file1",
      mimeType: "image/png",
      dataURL: pngDataUrl(900),
      created: 1,
    };
  }
  return JSON.stringify({
    type: "excalidraw",
    version: 2,
    elements,
    appState: { viewBackgroundColor: "#ffffff" },
    files,
  });
};

const CASES = [
  ...SIZES.flatMap((n) => [
    { name: `${n}-rough`, json: () => scene(n, 1) },
    { name: `${n}-flat`, json: () => scene(n, 0) },
  ]),
  { name: "100-image", json: () => scene(100, 1, true) },
];

const pct = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length
    ? s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]
    : 0;
};
const r1 = (x: number) => Math.round(x * 10) / 10;

test.beforeAll(async () => {
  await build({
    configFile: path.join(desktopDir, "vite.e2e.config.mts"),
    root: desktopDir,
    base: "/__step0/",
    logLevel: "warn",
    build: {
      outDir,
      emptyOutDir: true,
      rollupOptions: {
        input: path.join(desktopDir, "e2e/thumbnailsStep0.html"),
      },
    },
  });
});

const openStep0 = async (page: Page, origin: string) => {
  await page.route(`${origin}/__step0/**`, async (route) => {
    const file = path.join(
      outDir,
      decodeURIComponent(new URL(route.request().url()).pathname).replace(
        /^\/__step0\//,
        "",
      ),
    );
    try {
      await route.fulfill({
        body: readFileSync(file),
        contentType: MIME[path.extname(file)] ?? "application/octet-stream",
      });
    } catch {
      await route.fulfill({ status: 404 });
    }
  });
  await page.goto(`${origin}/__step0/e2e/thumbnailsStep0.html`);
  await page.waitForFunction(() => Boolean((window as any).__step0));
};

for (const rate of [1, 4]) {
  test(`render step 0, cpu x${rate}`, async ({
    page,
    browserName,
    baseURL,
  }) => {
    test.skip(
      rate > 1 && browserName !== "chromium",
      "CDP throttling is chromium only",
    );
    await openStep0(page, new URL(baseURL!).origin);
    const cdp = rate > 1 ? await page.context().newCDPSession(page) : null;
    await cdp?.send("Emulation.setCPUThrottlingRate", { rate });
    for (const c of CASES) {
      const json = c.json();
      const res = await page.evaluate(
        async ({ json, runs, warmup }) => {
          const { renderScenePng } = (
            window as unknown as { __step0: Step0Hooks }
          ).__step0;
          const times: number[] = [];
          let fails = 0;
          let bytes = 0;
          let reason = "";
          for (let i = 0; i < runs + warmup; i++) {
            const t0 = performance.now();
            const r = await renderScenePng(json);
            const dt = performance.now() - t0;
            if (r.kind === "png") {
              bytes = r.blob.size;
            } else {
              fails++;
              reason = r.reason;
            }
            if (i >= warmup) {
              times.push(dt);
            }
          }
          return { times, fails, bytes, reason };
        },
        { json, runs: RUNS, warmup: WARMUP },
      );
      const row = {
        case: c.name,
        engine: browserName,
        cpuRate: rate,
        runs: RUNS,
        jsonKB: Math.round(json.length / 1024),
        p50: r1(pct(res.times, 50)),
        p95: r1(pct(res.times, 95)),
        max: r1(Math.max(...res.times)),
        pngKB: Math.round(res.bytes / 102.4) / 10,
        fails: res.fails,
        reason: res.reason,
      };
      console.log(`THUMB_STEP0 ${JSON.stringify(row)}`);
      expect(res.fails, `${c.name}: render failed (${res.reason})`).toBe(0);
    }
    await cdp?.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  });
}
