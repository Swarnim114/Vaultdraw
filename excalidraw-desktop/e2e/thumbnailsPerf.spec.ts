/* eslint-disable no-console */
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { deflateSync } from "node:zlib";

import { expect, test } from "@playwright/test";

import { build } from "vite";

import { openVault } from "./helpers";

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

test.describe("render step 0", () => {
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
});

// ---------------------------------------------------------------------------
// F2 thumbnails, QA E: gallery / startup / save-path measurements. One
// `THUMBS_PERF {json}` line per row (record.mjs spec: object {p50,p95,max}
// leaves become timings, numeric leaves single values; heap fields only on
// Chromium).
//
//   E2E_PERF=1 E2E_FULL=1 E2E_WORKERS=1 npx playwright test e2e/thumbnailsPerf.spec.ts -g "gallery 5k|startup|save path" --project=chromium

const emit = (row: Record<string, unknown>) =>
  console.log(`THUMBS_PERF ${JSON.stringify(row)}`);
const stats = (xs: number[]) => ({
  p50: r1(pct(xs, 50)),
  p95: r1(pct(xs, 95)),
  max: r1(xs.length ? Math.max(...xs) : 0),
});

const CYCLES = Number(process.env.THUMB_CYCLES ?? 10);
const DRAWINGS = Number(process.env.THUMB_DRAWINGS ?? 5000);

for (const rate of [1, 4]) {
  test(`gallery ${DRAWINGS} scroll, cpu x${rate}`, async ({
    page,
    browserName,
  }) => {
    test.skip(
      rate > 1 && browserName !== "chromium",
      "CDP throttling is chromium only",
    );
    await openVault(page, `?seed=bigfolder&n=${DRAWINGS}&el=1&thumbs=1`);
    const cdp =
      browserName === "chromium"
        ? await page.context().newCDPSession(page)
        : null;
    const heap = async () => {
      if (!cdp) {
        return null;
      }
      await cdp.send("HeapProfiler.collectGarbage");
      return page.evaluate(
        () => (performance as any).memory.usedJSHeapSize / 1048576,
      );
    };
    const heap0 = await heap();
    if (rate > 1) {
      await cdp?.send("Emulation.setCPUThrottlingRate", { rate });
    }

    // Open the gallery at the vault root, move to the big folder and enter it:
    // time from that Enter to the first tile image and to every visible tile ready.
    await page.keyboard.press("ControlOrMeta+Alt+KeyE");
    const grid = page.getByRole("grid", { name: /Gallery/ });
    await expect(grid).toBeFocused();
    await page.evaluate(() => {
      const w = window as any;
      w.__t = { enter: 0, first: 0, ready: 0 };
      addEventListener(
        "keydown",
        (e) => {
          if (e.key === "Enter" && !w.__t.enter) {
            w.__t.enter = performance.now();
          }
        },
        true,
      );
      const visibleCells = () => {
        const sc = document.querySelector("[role=grid]");
        if (!sc) {
          return [];
        }
        const r = sc.getBoundingClientRect();
        return [...sc.querySelectorAll("[role=gridcell]")].filter((c) => {
          const b = c.getBoundingClientRect();
          return b.bottom > r.top && b.top < r.bottom;
        });
      };
      const tick = () => {
        const t = w.__t;
        if (t.enter) {
          if (
            !t.first &&
            document.querySelector("[role=grid] img.vault-thumb")
          ) {
            t.first = performance.now();
          }
          const cells = visibleCells();
          const settled =
            cells.length > 15 &&
            cells.every(
              (c) => c.querySelector(".vault-thumb")?.tagName === "IMG",
            );
          if (!t.ready && settled) {
            t.ready = performance.now();
          }
        }
        if (!t.ready) {
          requestAnimationFrame(tick);
        }
      };
      requestAnimationFrame(tick);
    });
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("gallery-count")).toHaveText(
      `${DRAWINGS} items`,
    );
    await page.waitForFunction(() => (window as any).__t.ready, undefined, {
      timeout: 60_000,
    });
    const t = await page.evaluate(() => (window as any).__t);
    const putsAfterOpen = await page.evaluate(
      () => (window as any).__thumbStore.calls.put as number,
    );

    // 10 x (top -> bottom -> top), one scroll step per frame.
    const res = await page.evaluate(
      async ({ cycles }) => {
        const sc = document.querySelector<HTMLElement>("[role=grid]")!;
        const max = sc.scrollHeight - sc.clientHeight;
        const step = 1200;
        const frames: number[] = [];
        let mountedMax = 0;
        let imgMax = 0;
        let f = 0;
        const sample = () => {
          mountedMax = Math.max(
            mountedMax,
            sc.querySelectorAll("[role=gridcell]").length,
          );
          imgMax = Math.max(
            imgMax,
            document.querySelectorAll("img.vault-thumb").length,
          );
        };
        await new Promise<void>((resolve) => {
          let dir = 1;
          let legs = 0;
          let last = performance.now();
          const frame = (now: number) => {
            if (f++ > 3) {
              frames.push(now - last);
            }
            last = now;
            sc.scrollTop = Math.min(
              max,
              Math.max(0, sc.scrollTop + dir * step),
            );
            if (f % 4 === 0) {
              sample();
            }
            if (
              (dir > 0 && sc.scrollTop >= max) ||
              (dir < 0 && sc.scrollTop <= 0)
            ) {
              dir = -dir;
              legs++;
            }
            if (legs >= cycles * 2) {
              resolve();
            } else {
              requestAnimationFrame(frame);
            }
          };
          requestAnimationFrame(frame);
        });
        sample();
        return { frames, mountedMax, imgMax };
      },
      { cycles: CYCLES },
    );
    // Let the queue drain, then measure the heap after everything settled.
    await page.waitForTimeout(1500);
    await cdp?.send("Emulation.setCPUThrottlingRate", { rate: 1 });
    const heap1 = await heap();
    const putsTotal = await page.evaluate(
      () => (window as any).__thumbStore.calls.put as number,
    );
    const row = {
      name: `gallery${DRAWINGS}`,
      browser: browserName,
      cpuRate: rate,
      cycles: CYCLES,
      frame: stats(res.frames),
      frameOver16: res.frames.filter((d) => d > 16.7 * 1.5).length,
      frameOver8: res.frames.filter((d) => d > 8.3 * 1.5).length,
      mountedTilesMax: res.mountedMax,
      imgMax: res.imgMax,
      firstTileMs: r1(t.first - t.enter),
      allVisibleReadyMs: r1(t.ready - t.enter),
      putsAfterOpen,
      putsTotal,
      ...(heap0 !== null && heap1 !== null
        ? {
            heapBeforeMB: r1(heap0),
            heapAfterMB: r1(heap1),
            heapGrowthMB: r1(heap1 - heap0),
          }
        : {}),
    };
    emit(row);
    expect(res.mountedMax).toBeLessThanOrEqual(120);
    if (rate === 1) {
      expect(row.firstTileMs).toBeLessThan(300);
      if (heap0 !== null && heap1 !== null) {
        expect(heap1 - heap0).toBeLessThan(20);
      }
    }
  });
}

test("startup: thumbnails on vs off, no IPC and no gallery chunk before a surface", async ({
  browser,
  browserName,
}) => {
  const ROUNDS = Number(process.env.THUMB_ROUNDS ?? 8);
  const homeMs: Record<string, number[]> = { on: [], off: [] };
  const tileMs: number[] = [];
  let lookupsAtHome = -1;
  let lookupsLater = 0;
  let galleryBefore = 0;
  let jsAfterOpen = 0;
  let galleryChunkLoaded = false;
  for (let i = 0; i < ROUNDS; i++) {
    for (const mode of ["on", "off"] as const) {
      const ctx = await browser.newContext({
        viewport: { width: 1280, height: 850 },
      });
      const page = await ctx.newPage();
      const js: string[] = [];
      page.on("request", (r) => {
        if (/\.js(\?|$)/.test(r.url())) {
          js.push(r.url());
        }
      });
      await page.addInitScript(() => {
        const w = window as any;
        w.__m = { nav: 0, home: 0, lookupsAtHome: -1, tile: 0 };
        new MutationObserver(() => {
          const m = w.__m;
          if (
            !m.nav &&
            document.querySelector('[aria-label="Vault File Navigator"]')
          ) {
            m.nav = performance.now();
          }
          if (
            !m.home &&
            document.querySelector('[aria-label="Recent drawings"]')
          ) {
            m.home = performance.now();
            m.lookupsAtHome = w.__thumbStore?.calls.lookup ?? -1;
          }
          if (!m.tile && document.querySelector("img.vault-thumb")) {
            m.tile = performance.now();
          }
        }).observe(document, { childList: true, subtree: true });
      });
      await openVault(page, `?seed=search${mode === "on" ? "&thumbs=1" : ""}`);
      await expect(page.getByLabel("Recent drawings")).toBeVisible();
      if (mode === "on") {
        await expect(page.locator("img.vault-thumb").first()).toBeVisible({
          timeout: 15_000,
        });
      }
      const m = await page.evaluate(() => (window as any).__m);
      homeMs[mode].push(m.home);
      if (mode === "on") {
        tileMs.push(m.tile - m.home);
        lookupsAtHome = m.lookupsAtHome;
        lookupsLater = await page.evaluate(
          () => (window as any).__thumbStore.calls.lookup as number,
        );
        galleryBefore = js.filter((u) => /gallery/i.test(u)).length;
        const before = js.length;
        await page.keyboard.press("ControlOrMeta+Alt+KeyE");
        await expect(page.getByTestId("gallery-view")).toBeVisible();
        jsAfterOpen = js.length - before;
        galleryChunkLoaded ||= js.some((u) => /gallery/i.test(u));
      }
      await ctx.close();
    }
  }
  emit({
    name: "startup",
    browser: browserName,
    rounds: ROUNDS,
    homeOnMs: stats(homeMs.on),
    homeOffMs: stats(homeMs.off),
    tileAfterHomeMs: stats(tileMs),
    lookupsAtFirstHomePaint: lookupsAtHome,
    lookupsAfterTiles: lookupsLater,
    galleryChunksBeforeOpen: galleryBefore,
    jsRequestsOnGalleryOpen: jsAfterOpen,
  });
  expect(lookupsAtHome).toBe(0);
  expect(galleryBefore).toBe(0);
  expect(jsAfterOpen).toBeGreaterThan(0); // the lazy chunk loads on demand
  expect(galleryChunkLoaded || jsAfterOpen > 0).toBe(true);
});

test("save path: dirty -> saved with thumbnails on vs off", async ({
  browser,
  browserName,
}) => {
  const ROUNDS = Number(process.env.THUMB_ROUNDS ?? 12);
  const ms: Record<string, number[]> = { on: [], off: [] };
  for (let i = 0; i < ROUNDS; i++) {
    for (const mode of ["on", "off"] as const) {
      const ctx = await browser.newContext({
        viewport: { width: 1280, height: 850 },
      });
      const page = await ctx.newPage();
      await openVault(page, `?seed=search${mode === "on" ? "&thumbs=1" : ""}`);
      if (mode === "on") {
        await expect(page.locator("img.vault-thumb").first()).toBeVisible({
          timeout: 15_000,
        });
      }
      await page.locator("button.vault-recent__item").first().click();
      await expect(
        page.locator(".vault-editor canvas.interactive"),
      ).toBeVisible();
      await page.waitForTimeout(600);
      await page.evaluate(() => {
        const w = window as any;
        w.__s = { dirty: 0, saved: 0 };
        new MutationObserver(() => {
          const s = w.__s;
          if (
            !s.dirty &&
            document.querySelector(
              ".vault-status--dirty, .vault-status--saving",
            )
          ) {
            s.dirty = performance.now();
          }
          if (
            s.dirty &&
            !s.saved &&
            document.querySelector(".vault-status--saved")
          ) {
            s.saved = performance.now();
          }
        }).observe(document.body, {
          childList: true,
          subtree: true,
          attributes: true,
        });
      });
      const box = (await page
        .locator(".vault-editor canvas.interactive")
        .boundingBox())!;
      await page
        .locator(".vault-editor [data-testid='toolbar-rectangle']")
        .click();
      await page.mouse.move(box.x + 300, box.y + 250);
      await page.mouse.down();
      await page.mouse.move(box.x + 420, box.y + 330, { steps: 4 });
      await page.mouse.up();
      await page.waitForFunction(() => (window as any).__s.saved, undefined, {
        timeout: 5000,
      });
      const s = await page.evaluate(() => (window as any).__s);
      ms[mode].push(s.saved - s.dirty);
      await ctx.close();
    }
  }
  const on = stats(ms.on);
  const off = stats(ms.off);
  emit({
    name: "savePath",
    browser: browserName,
    rounds: ROUNDS,
    onMs: on,
    offMs: off,
    deltaP50Ms: r1(on.p50 - off.p50),
  });
  // Autosave debounce dominates (100 ms in e2e); the hook must not add noticeable time.
  expect(on.p50 - off.p50).toBeLessThan(15);
});
