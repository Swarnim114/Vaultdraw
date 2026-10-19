import { expect, test, type Page } from "@playwright/test";

import { AFTER_AUTOSAVE_MS } from "./constants";
import { openVault, readScene, trackErrors } from "./helpers";
import {
  focusCanvas,
  pixelAtClient,
  runCommand,
  toClient,
} from "./pageHelpers";

// LaTeX formulas: insert, edit, undo, persistence, dark theme, perf.

const SRC = String.raw`\int_0^1 x^2\,dx`;

/** The editor's App instance (found through React's fibers). */
const appHandle = `(() => {
  const el = document.querySelector(".vault-editor canvas.interactive");
  const key = Object.keys(el).find((k) => k.startsWith("__reactFiber"));
  let fiber = el[key];
  while (fiber) {
    const s = fiber.stateNode;
    if (s && s.state && s.scene && typeof s.state.scrollX === "number" && "zoom" in s.state) return s;
    fiber = fiber.return;
  }
  throw new Error("editor instance not found");
})()`;

type Img = {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fileId: string;
  customData: any;
  crop: unknown;
};

const scene = (page: Page) =>
  page.evaluate(
    (code) => {
      const app = (0, eval)(code);
      const els = app.scene.getNonDeletedElements();
      return {
        elements: els.map((e: any) => ({
          id: e.id,
          type: e.type,
          x: e.x,
          y: e.y,
          width: e.width,
          height: e.height,
          fileId: e.fileId,
          customData: e.customData,
          crop: e.crop ?? null,
        })) as Img[],
        files: JSON.parse(JSON.stringify(app.files)) as Record<string, any>,
        selected: Object.keys(app.state.selectedElementIds).filter(
          (k) => app.state.selectedElementIds[k],
        ),
        croppingElementId: app.state.croppingElementId ?? null,
      };
    },
    appHandle,
  );

const images = async (page: Page) =>
  (await scene(page)).elements.filter((e) => e.type === "image");

const decodeSvg = (dataURL: string) =>
  Buffer.from(dataURL.split(",")[1], "base64").toString("utf8");

const dialog = (page: Page) => page.getByRole("dialog", { name: /formula/i });
const preview = (page: Page) =>
  dialog(page).getByRole("img", { name: "Formula preview" });
const source = (page: Page) => dialog(page).getByLabel("LaTeX");

const previewSrc = (page: Page) => preview(page).getAttribute("src");

const confirmKey = (page: Page) => page.keyboard.press("ControlOrMeta+Enter");

const insertViaPalette = async (page: Page, tex: string) => {
  await runCommand(page, "Formula: Insert formula");
  await expect(dialog(page)).toBeVisible();
  await source(page).fill(tex);
  await expect(preview(page)).toBeVisible();
  await confirmKey(page);
  await expect(dialog(page)).toHaveCount(0);
  await expect.poll(async () => (await images(page)).length).toBeGreaterThan(0);
};

const centreOf = (e: Img) => ({ x: e.x + e.width / 2, y: e.y + e.height / 2 });

const openEmpty = async (page: Page, name = "Formula.excalidraw") => {
  await openVault(page);
  await page.evaluate((n) => {
    const repo = (window as any).__vaultRepo;
    repo.seedDrawing(
      n,
      JSON.stringify({
        type: "excalidraw",
        version: 2,
        elements: [],
        appState: { viewBackgroundColor: "#ffffff" },
        files: {},
      }),
    );
    repo.emit({ handle: repo.handle, paths: [], rescan: true });
  }, name);
  await page
    .locator(".vault-tree-item__name", { hasText: name.replace(/\.excalidraw$/, "") })
    .first()
    .click();
  await expect(page.locator(".vault-editor canvas.interactive")).toBeVisible();
  await page.waitForTimeout(600);
  await focusCanvas(page);
};

const dblclickElement = async (page: Page, e: Img) => {
  const c = centreOf(e);
  const p = await toClient(page, c.x, c.y);
  await page.mouse.dblclick(p.x, p.y);
};

test.describe("formula", () => {
  test("palette insert, shortcut insert with $$, error, edit, undo", async ({
    page,
  }) => {
    const errors = trackErrors(page);
    await openEmpty(page);

    // 1. palette insert
    await runCommand(page, "Formula: Insert formula");
    await expect(dialog(page)).toBeVisible();
    await source(page).fill(SRC);
    await expect(preview(page)).toBeVisible();
    await confirmKey(page);
    await expect(dialog(page)).toHaveCount(0);
    await expect.poll(async () => (await images(page)).length).toBe(1);
    let s = await scene(page);
    const el1 = s.elements[0];
    expect(el1.customData.latex.source).toBe(SRC);
    expect(el1.customData.latex.display).toBe(true);
    const file = s.files[el1.fileId];
    expect(file.mimeType).toBe("image/svg+xml");
    expect(file.dataURL.startsWith("data:image/svg+xml;base64")).toBe(true);
    const svg = decodeSvg(file.dataURL);
    expect(svg).toContain("<path");
    expect(svg).not.toMatch(/foreignObject|<script/i);
    expect(el1.width).toBeGreaterThan(0);
    expect(el1.height).toBeGreaterThan(0);
    expect(s.selected).toEqual([el1.id]);

    // 2. shortcut + $$ delimiters
    await page.keyboard.press("Escape");
    await focusCanvas(page);
    await page.keyboard.press("ControlOrMeta+Shift+KeyM");
    await expect(dialog(page)).toBeVisible();
    await source(page).fill("$$a^2+b^2=c^2$$");
    await expect(preview(page)).toBeVisible();
    await confirmKey(page);
    await expect.poll(async () => (await images(page)).length).toBe(2);
    s = await scene(page);
    const el2 = s.elements.find((e) => e.id !== el1.id)!;
    expect(el2.customData.latex.display).toBe(true);
    expect(el2.customData.latex.source).toBe("a^2+b^2=c^2");

    // 3. error state; Escape inserts nothing
    await focusCanvas(page);
    await runCommand(page, "Formula: Insert formula");
    await source(page).fill(String.raw`\frac{`);
    await expect(dialog(page).getByRole("alert")).toBeVisible();
    await expect(dialog(page).getByRole("button", { name: "Insert" })).toBeDisabled();
    await confirmKey(page);
    await expect(dialog(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog(page)).toHaveCount(0);
    expect((await images(page)).length).toBe(2);

    // 4. edit by double-click
    await focusCanvas(page);
    // move el2 away from el1 (both are at the view centre): use el1 only via a fresh scene lookup
    s = await scene(page);
    // el1 and el2 overlap; delete el2 first so the double-click hits el1
    await page.evaluate(
      ([code, id]) => {
        const app = (0, eval)(code as string);
        app.updateScene({
          elements: app.scene
            .getElementsIncludingDeleted()
            .map((e: any) => (e.id === id ? { ...e, isDeleted: true } : e)),
        });
      },
      [appHandle, el2.id] as const,
    );
    await expect.poll(async () => (await images(page)).length).toBe(1);
    await focusCanvas(page);
    const before = (await images(page))[0];
    const c0 = centreOf(before);
    await dblclickElement(page, before);
    await expect(dialog(page)).toBeVisible();
    await expect(source(page)).toHaveValue(SRC);
    await source(page).fill(String.raw`\sum_{n=1}^{\infty} \frac1{n^2}`);
    await expect(preview(page)).toBeVisible();
    await expect
      .poll(async () => (await previewSrc(page))?.length ?? 0)
      .toBeGreaterThan(0);
    await page.waitForTimeout(400);
    await confirmKey(page);
    await expect(dialog(page)).toHaveCount(0);
    await expect
      .poll(async () => (await images(page))[0].fileId)
      .not.toBe(before.fileId);
    s = await scene(page);
    const after = s.elements.find((e) => e.type === "image")!;
    expect(after.id).toBe(before.id);
    expect(after.customData.latex.source).toBe(String.raw`\sum_{n=1}^{\infty} \frac1{n^2}`);
    const c1 = centreOf(after);
    expect(Math.abs(c1.x - c0.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(c1.y - c0.y)).toBeLessThanOrEqual(1);
    expect(s.croppingElementId).toBeNull();

    // undo restores in one step
    // (no focusCanvas click here: deselecting is itself an undo entry)
    await page.keyboard.press("ControlOrMeta+KeyZ");
    await expect
      .poll(async () => (await images(page))[0]?.fileId)
      .toBe(before.fileId);
    const undone = (await images(page))[0];
    expect(undone.customData.latex.source).toBe(SRC);

    // 6. persistence
    await page.waitForTimeout(AFTER_AUTOSAVE_MS + 300);
    const saved = await readScene(page, "Formula.excalidraw");
    const savedImg = saved.elements.find((e: any) => e.type === "image" && !e.isDeleted);
    expect(savedImg.customData.latex.source).toBe(SRC);
    expect(saved.files[savedImg.fileId].mimeType).toBe("image/svg+xml");

    expect(errors).toEqual([]);
  });

  test("Enter and the Edit command open the edit dialog; dark theme; plain image still crops", async ({
    page,
  }) => {
    const errors = trackErrors(page);
    await openEmpty(page, "Formula2.excalidraw");
    await insertViaPalette(page, String.raw`E=mc^2`);
    // element is selected: Enter opens edit
    await focusCanvas(page);
    const el = (await images(page))[0];
    await page.evaluate(
      ([code, id]) => {
        const app = (0, eval)(code as string);
        app.setState({ selectedElementIds: { [id as string]: true } });
      },
      [appHandle, el.id] as const,
    );
    await page.keyboard.press("Enter");
    await expect(dialog(page)).toBeVisible();
    await expect(source(page)).toHaveValue("E=mc^2");
    await page.keyboard.press("Escape");
    await expect(dialog(page)).toHaveCount(0);
    expect((await scene(page)).croppingElementId).toBeNull();

    // Edit command
    await runCommand(page, "Formula: Edit formula");
    await expect(dialog(page)).toBeVisible();
    await expect(source(page)).toHaveValue("E=mc^2");
    await page.keyboard.press("Escape");
    await expect(dialog(page)).toHaveCount(0);

    // dark theme
    await runCommand(page, "Mode: Dark");
    await expect(page.locator(".excalidraw.theme--dark").first()).toBeVisible();
    await page.waitForTimeout(500);
    const c = centreOf(el);
    const p = await toClient(page, c.x, c.y);
    // Light-on-dark: some pixel in the formula's box is brighter than the dark background.
    const bg = await pixelAtClient(page, p.x - el.width, p.y);
    let brightest = 0;
    for (let dx = -el.width / 2; dx <= el.width / 2; dx += 1) {
      for (const dy of [-4, 0, 4]) {
        const px = await pixelAtClient(page, p.x + dx, p.y + dy);
        brightest = Math.max(brightest, px[0] + px[1] + px[2]);
      }
    }
    expect(brightest).toBeGreaterThan(bg[0] + bg[1] + bg[2] + 150);
    await runCommand(page, "Mode: Light");

    // plain svg image: double-click enters crop mode
    await page.evaluate(
      ([code]) => {
        const app = (0, eval)(code as string);
        const svg =
          '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80" viewBox="0 0 120 80"><rect width="120" height="80" fill="#c00"/></svg>';
        const fileId = "plainsvg0000000000000000000000000000000001";
        app.addFiles([
          {
            id: fileId,
            mimeType: "image/svg+xml",
            dataURL: "data:image/svg+xml;base64," + btoa(svg),
            created: Date.now(),
          },
        ]);
        const base = app.scene.getNonDeletedElements()[0];
        app.updateScene({
          elements: [
            ...app.scene.getElementsIncludingDeleted(),
            {
              ...base,
              id: "plainimg",
              fileId,
              x: base.x + 400,
              y: base.y + 300,
              width: 160,
              height: 100,
              customData: undefined,
              versionNonce: 12345,
            },
          ],
        });
      },
      [appHandle] as const,
    );
    await page.waitForTimeout(500);
    await focusCanvas(page);
    const plain = (await images(page)).find((e) => e.id === "plainimg")!;
    await dblclickElement(page, plain);
    await expect
      .poll(async () => (await scene(page)).croppingElementId)
      .toBe("plainimg");
    await expect(dialog(page)).toHaveCount(0);
    expect(errors).toEqual([]);
  });
});

const PERF = process.env.E2E_PERF === "1";

const pct = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)];
};
const print = (name: string, v: number) =>
  // eslint-disable-next-line no-console
  console.log(`PERF formula.${name} ${v.toFixed(1)}ms`);

test.describe("formula perf", () => {
  test.skip(!PERF, "set E2E_PERF=1");

  test("first formula latency, warm render, insert cost", async ({ page }) => {
    test.setTimeout(180_000);
    // (a) cold worker, 5 reloads
    const first: number[] = [];
    for (let i = 0; i < 5; i++) {
      await openEmpty(page, `Perf${i}.excalidraw`);
      await page.keyboard.press("ControlOrMeta+Shift+KeyP");
      await page.keyboard.type("Formula: Insert formula");
      await expect(
        page.getByRole("dialog", { name: "Command palette" }).getByRole("option").first(),
      ).toContainText("Formula: Insert formula");
      await page.evaluate(() => (window as any).__fmT0 = null);
      const t0 = Date.now();
      await page.keyboard.press("Enter");
      const t0p = await page.evaluate(() => performance.now());
      await source(page).fill(SRC);
      await preview(page).waitFor({ state: "visible" });
      const t1p = await page.evaluate(() => performance.now());
      void t0;
      first.push(t1p - t0p);
    }
    print("firstPreviewP50", pct(first, 50));
    print("firstPreviewMax", Math.max(...first));

    // (b) warm: typing -> preview changes (includes the 120 ms debounce)
    await openEmpty(page, "PerfWarm.excalidraw");
    await runCommand(page, "Formula: Insert formula");
    await source(page).fill(SRC);
    await preview(page).waitFor({ state: "visible" });
    const warm: number[] = [];
    for (let i = 0; i < 50; i++) {
      const prev = await previewSrc(page);
      const t0 = await page.evaluate(() => performance.now());
      await source(page).fill(String.raw`\frac{${i + 2}}{x^{${i + 3}}} + \sqrt{${i + 5}}`);
      await expect
        .poll(() => previewSrc(page), { intervals: [5, 5, 5, 10], timeout: 5000 })
        .not.toBe(prev);
      const t1 = await page.evaluate(() => performance.now());
      warm.push(t1 - t0);
    }
    print("warmTypingToPreviewP50", pct(warm, 50));
    print("warmTypingToPreviewP95", pct(warm, 95));
    print("warmMinusDebounceP50", pct(warm, 50) - 120);
    print("warmMinusDebounceP95", pct(warm, 95) - 120);

    // (c) insert cost: Cmd+Enter keydown -> element in scene
    await page.evaluate((code) => {
      const app = (0, eval)(code);
      const w = window as any;
      w.__ins = null;
      window.addEventListener(
        "keydown",
        (e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) w.__t0 = performance.now();
        },
        true,
      );
      const n0 = app.scene.getNonDeletedElements().length;
      const tick = () => {
        if (app.scene.getNonDeletedElements().length > n0) {
          w.__ins = performance.now() - w.__t0;
        } else requestAnimationFrame(tick);
      };
      w.__armInsert = () => requestAnimationFrame(tick);
    }, appHandle);
    await page.evaluate(() => (window as any).__armInsert());
    await confirmKey(page);
    await expect
      .poll(() => page.evaluate(() => (window as any).__ins))
      .not.toBeNull();
    print(
      "insertCost",
      await page.evaluate(() => (window as any).__ins as number),
    );
  });
});
