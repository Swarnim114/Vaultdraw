import { expect, test, type Page } from "@playwright/test";

import { AFTER_AUTOSAVE_MS } from "./constants";
import {
  canvasBox,
  openDrawing,
  openVault,
  readScene,
  trackErrors,
} from "./helpers";

const DRAWING = "DSA/Graphs.excalidraw";

const palette = (page: Page) =>
  page.getByRole("dialog", { name: "Command palette" });
const input = (page: Page) => page.getByLabel("Search drawings and commands");
const options = (page: Page) => palette(page).getByRole("option");

const rect = (id: string, x: number, y: number) => ({
  id,
  type: "rectangle",
  x,
  y,
  width: 120,
  height: 80,
  angle: 0,
  strokeColor: "#1e1e1e",
  backgroundColor: "transparent",
  fillStyle: "solid",
  strokeWidth: 2,
  strokeStyle: "solid",
  roughness: 1,
  opacity: 100,
  groupIds: [],
  frameId: null,
  roundness: null,
  boundElements: [],
  link: null,
  locked: false,
  isDeleted: false,
});

/** Overwrites DSA/Graphs with two rectangles at different x (before opening). */
const seedTwoRects = (page: Page) =>
  page.evaluate(
    ([a, b]) => {
      (window as any).__vaultRepo.seedDrawing(
        "DSA/Graphs.excalidraw",
        JSON.stringify({
          type: "excalidraw",
          version: 2,
          elements: [a, b],
          appState: {},
          files: {},
        }),
      );
    },
    [rect("a", 60, 60), rect("b", 300, 200)],
  );

const openGraphs = async (page: Page, query = "") => {
  await openVault(page, query);
  await page
    .locator(".vault-tree-item__name", { hasText: "DSA" })
    .first()
    .click();
  await openDrawing(page, "Graphs");
};

const focusCanvas = async (page: Page) => {
  const box = await canvasBox(page);
  await page.mouse.click(box.x + box.width * 0.9, box.y + box.height * 0.9);
};

const liveElements = async (page: Page) =>
  (await readScene(page, DRAWING)).elements.filter((el: any) => !el.isDeleted);

const runQuery = async (page: Page, query: string, expectFirst: string) => {
  await page.keyboard.press("ControlOrMeta+KeyP");
  await expect(palette(page)).toBeVisible();
  await page.keyboard.type(query);
  await expect(options(page).first()).toContainText(expectFirst);
};

const rootVar = (page: Page, name: string) =>
  page.evaluate(
    (n) =>
      getComputedStyle(document.documentElement).getPropertyValue(n).trim(),
    name,
  );

test.describe("editor, theme and mode commands", () => {
  test("'>align left' aligns the selection and keeps it selected", async ({
    page,
  }) => {
    const errors = trackErrors(page);
    await openVault(page);
    await page
      .locator(".vault-tree-item__name", { hasText: "DSA" })
      .first()
      .click();
    await seedTwoRects(page);
    await openDrawing(page, "Graphs");
    await focusCanvas(page);
    await page.keyboard.press("ControlOrMeta+KeyA");

    await runQuery(page, ">align left", "Align left");
    await page.keyboard.press("Enter");
    await expect(palette(page)).toHaveCount(0);

    await page.waitForTimeout(AFTER_AUTOSAVE_MS);
    await expect
      .poll(async () => (await liveElements(page)).map((e: any) => e.x))
      .toEqual([60, 60]);
    // Both are still selected: the selection toolbar shows the multi-select
    // alignment actions and Excalidraw reports two selected elements.
    await expect(page.locator(".selected-shape-actions")).toBeVisible();
    await page.keyboard.press("ControlOrMeta+KeyP");
    await page.keyboard.type(">align right");
    await expect(options(page).first()).toContainText("Align right");
    await page.keyboard.press("Escape");
    expect(errors).toEqual([]);
  });

  test("'Theme: Dracula' switches the theme", async ({ page }) => {
    const errors = trackErrors(page);
    await openGraphs(page);
    const before = await rootVar(page, "--vault-bg");
    await runQuery(page, "theme: dracula", "Theme: Dracula");
    await page.keyboard.press("Enter");
    await expect(palette(page)).toHaveCount(0);
    await expect.poll(() => rootVar(page, "--vault-bg")).not.toBe(before);
    // Enter closes and hands focus back to the canvas.
    await expect
      .poll(() =>
        page.evaluate(() =>
          document
            .querySelector(".vault-editor .excalidraw-container")
            ?.contains(document.activeElement),
        ),
      )
      .toBe(true);
    expect(errors).toEqual([]);
  });

  test("'Mode: Dark' makes the app dark", async ({ page }) => {
    await openGraphs(page);
    const isDark = () =>
      page.evaluate(() => document.documentElement.classList.contains("dark"));
    expect(await isDark()).toBe(false);
    await runQuery(page, ">mode: dark", "Mode: Dark");
    await page.keyboard.press("Enter");
    await expect.poll(isDark).toBe(true);
    await expect(page.locator(".excalidraw.theme--dark").first()).toBeVisible();
  });

  test("Mod+Enter on 'Toggle grid' keeps the palette open and toggles the grid", async ({
    page,
  }) => {
    await openGraphs(page);
    const grid = async () =>
      (await readScene(page, DRAWING)).appState.gridModeEnabled === true;
    expect(await grid()).toBe(false);
    await runQuery(page, ">toggle grid", "Toggle grid");
    await page.keyboard.press("ControlOrMeta+Enter");
    await expect(palette(page)).toBeVisible();
    await expect(input(page)).toBeFocused();
    await page.waitForTimeout(AFTER_AUTOSAVE_MS);
    await expect.poll(grid).toBe(true);
    await page.keyboard.press("ControlOrMeta+Enter");
    await expect(palette(page)).toBeVisible();
    await page.waitForTimeout(AFTER_AUTOSAVE_MS);
    await expect.poll(grid).toBe(false);
  });
});

test.describe("opening, shortcuts and focus", () => {
  test("typing a drawing name and Enter opens the drawing", async ({
    page,
  }) => {
    const errors = trackErrors(page);
    await openVault(page);
    await page.keyboard.press("ControlOrMeta+KeyP");
    await expect(palette(page)).toBeVisible();
    await page.keyboard.type("introduction");
    await expect(options(page).first()).toContainText("01 Introduction");
    // One merged list: no group headers while querying.
    await expect(palette(page).getByRole("group")).toHaveCount(0);
    await page.keyboard.press("Enter");
    await expect(palette(page)).toHaveCount(0);
    await expect(
      page.locator(".vault-editor canvas.interactive"),
    ).toBeVisible();
    await expect(page.getByLabel("Breadcrumb")).toContainText(
      "01 Introduction",
    );
    expect(errors).toEqual([]);
  });

  for (const chord of ["ControlOrMeta+Slash", "ControlOrMeta+Shift+KeyP"]) {
    test(`${chord} opens our palette, never Excalidraw's`, async ({ page }) => {
      const errors = trackErrors(page);
      await openGraphs(page);
      await focusCanvas(page);
      await page.keyboard.press(chord);
      await expect(palette(page)).toBeVisible();
      await expect(input(page)).toBeFocused();
      await page.waitForTimeout(400);
      await expect(page.locator(".command-palette-dialog")).toHaveCount(0);
      await expect(page.locator(".Toast")).toHaveCount(0);
      await expect(page.getByRole("dialog")).toHaveCount(1);
      await page.keyboard.press("Escape");
      await expect(palette(page)).toHaveCount(0);
      expect(errors).toEqual([]);
    });
  }

  test("Escape closes and focus returns to the canvas", async ({ page }) => {
    await openGraphs(page);
    await focusCanvas(page);
    await page.keyboard.press("ControlOrMeta+KeyP");
    await expect(palette(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(palette(page)).toHaveCount(0);
    await expect
      .poll(() =>
        page.evaluate(() =>
          document
            .querySelector(".vault-editor .excalidraw-container")
            ?.contains(document.activeElement),
        ),
      )
      .toBe(true);
  });

  test("Tab drills a theme into '>Theme: '", async ({ page }) => {
    await openVault(page);
    await page.keyboard.press("ControlOrMeta+KeyP");
    await page.keyboard.type("theme");
    await expect(options(page).first()).toContainText("Theme: ");
    await page.keyboard.press("Tab");
    await expect(input(page)).toHaveValue(">Theme: ");
    await expect(input(page)).toBeFocused();
    const count = await options(page).count();
    expect(count).toBeGreaterThan(1);
    for (let i = 0; i < count; i++) {
      await expect(options(page).nth(i)).toContainText("Theme: ");
    }
  });
});

test.describe("navigator collapsed", () => {
  const collapse = async (page: Page) => {
    await page.keyboard.press("ControlOrMeta+Backslash");
    await expect(page.getByLabel("Vault File Navigator")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
  };

  test("'Rename drawing' works", async ({ page }) => {
    const errors = trackErrors(page);
    await openGraphs(page);
    await collapse(page);
    await runQuery(page, ">rename drawing", "Rename drawing");
    await page.keyboard.press("Enter");
    // The modal is rendered inside the aria-hidden navigator, so role/label
    // queries cannot see it (an a11y bug); find it by CSS.
    const dialog = page.locator(".vault-modal", { hasText: "Rename Drawing" });
    await expect(dialog).toBeVisible();
    await dialog.locator("input").fill("Graphs Renamed");
    await dialog.locator("button[type=submit]").click();
    await expect
      .poll(
        async () =>
          (
            await readScene(page, "DSA/Graphs Renamed.excalidraw")
          ).elements.length,
      )
      .toBeGreaterThan(0);
    expect(errors).toEqual([]);
  });

  test("'New folder' works", async ({ page }) => {
    const errors = trackErrors(page);
    await openGraphs(page);
    await collapse(page);
    await runQuery(page, ">new folder", "New folder");
    await page.keyboard.press("Enter");
    const dialog = page.locator(".vault-modal", { hasText: "New Folder" });
    await expect(dialog).toBeVisible();
    await expect(dialog.locator("input")).toBeFocused();
    await dialog.locator("input").fill("Palette Folder");
    await dialog.locator("button[type=submit]").click();
    await expect(dialog).toHaveCount(0);
    // Expand the navigator: the folder exists.
    await page.keyboard.press("ControlOrMeta+Backslash");
    await expect(
      page.locator(".vault-tree-item__name", { hasText: "Palette Folder" }),
    ).toBeVisible();
    expect(errors).toEqual([]);
  });
});

test("perf: palette on 5,000 drawings with an open editor", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await openGraphs(page, "?seed=names5k");
  await focusCanvas(page);
  await page.keyboard.press("ControlOrMeta+KeyA");

  const open = await page.evaluate(async () => {
    const t0 = performance.now();
    const marks: { rows?: number; listed?: number } = {};
    const done = new Promise<void>((resolve) => {
      const check = () => {
        const rows = document.querySelectorAll(".vault-quick__row");
        if (rows.length && marks.rows === undefined) {
          marks.rows = performance.now() - t0;
        }
        if (
          marks.listed === undefined &&
          [...rows].some((r) => r.textContent?.includes("Area "))
        ) {
          marks.listed = performance.now() - t0;
          observer.disconnect();
          resolve();
        }
      };
      const observer = new MutationObserver(check);
      observer.observe(document.body, { childList: true, subtree: true });
    });
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "p",
        code: "KeyP",
        metaKey: /Mac/i.test(navigator.platform),
        ctrlKey: !/Mac/i.test(navigator.platform),
        bubbles: true,
        cancelable: true,
      }),
    );
    await Promise.race([done, new Promise((r) => setTimeout(r, 15_000))]);
    return marks;
  });
  await expect(palette(page)).toBeVisible();
  expect(open.listed, "names list rendered").toBeDefined();

  // Editor items are in the list (opened from the canvas with a drawing open).
  await page.keyboard.type(">align");
  await expect(palette(page).getByText("Align left").first()).toBeVisible();
  await page.keyboard.press("ControlOrMeta+KeyA");
  await page.keyboard.press("Backspace");

  const samples = await page.evaluate(async () => {
    const el = document.querySelector<HTMLInputElement>(".vault-quick__input")!;
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!;
    const frame = () =>
      new Promise<void>((r) =>
        requestAnimationFrame(() => requestAnimationFrame(() => r())),
      );
    const queries = ["dsgndrft53", ">thmdrk", "alignl"];
    const commit: number[] = [];
    const paint: number[] = [];
    for (const query of queries) {
      for (let round = 0; round < 3; round++) {
        setter.call(el, "");
        el.dispatchEvent(new Event("input", { bubbles: true }));
        await frame();
        for (let i = 1; i <= query.length; i++) {
          setter.call(el, query.slice(0, i));
          const t0 = performance.now();
          el.dispatchEvent(new Event("input", { bubbles: true }));
          const t1 = performance.now();
          await frame();
          const t2 = performance.now();
          commit.push(t1 - t0);
          paint.push(t2 - t0);
        }
      }
    }
    return { commit, paint };
  });

  const stat = (values: number[]) => {
    const sorted = [...values].sort((a, b) => a - b);
    const at = (p: number) =>
      sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
    return {
      p50: +at(0.5).toFixed(2),
      p95: +at(0.95).toFixed(2),
      max: +sorted[sorted.length - 1].toFixed(2),
    };
  };
  const report = {
    drawings: 5000,
    openMs: {
      firstRows: +(open.rows ?? 0).toFixed(1),
      names5kRendered: +(open.listed ?? 0).toFixed(1),
    },
    keystrokes: samples.commit.length,
    commitMs: stat(samples.commit),
    toNextFrameMs: stat(samples.paint),
  };
  // eslint-disable-next-line no-console
  console.log(`COMMAND_PALETTE_PERF ${JSON.stringify(report)}`);
  expect(report.commitMs.p95).toBeLessThan(16);
});
