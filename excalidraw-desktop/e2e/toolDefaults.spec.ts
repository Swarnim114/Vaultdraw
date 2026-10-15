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
const SHOTS = "test-results/tool-defaults";
const ORANGE = "#f08c00";

const live = async (page: Page) =>
  (await readScene(page, DRAWING)).elements.filter((el: any) => !el.isDeleted);

const toolButton = (page: Page, name: string) =>
  page.locator(`.vault-editor [data-testid='toolbar-${name}']`);

/** Polls until the toolbar shows `name` as the active tool. */
const expectTool = (page: Page, name: string) =>
  expect
    .poll(() =>
      toolButton(page, name).evaluate(
        (el: any) =>
          el.checked ??
          el.querySelector("input")?.checked ??
          el.getAttribute("aria-pressed") === "true",
      ),
    )
    .toBe(true);

/** Drags a shape from (fx, fy) by (dx, dy). */
const drag = async (page: Page, fx: number, fy: number, dx = 160, dy = 70) => {
  const box = await canvasBox(page);
  const x = box.x + box.width * fx;
  const y = box.y + box.height * fy;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx / 2, y + dy / 2, { steps: 5 });
  await page.mouse.move(x + dx, y + dy, { steps: 5 });
  await page.mouse.up();
};

/** Draws with the current tool, then returns the one new element of `type`. */
const drawAndRead = async (page: Page, type: string, fy: number, fx = 0.3) => {
  const before = new Set((await live(page)).map((el: any) => el.id));
  await drag(page, fx, fy);
  const isNew = (el: any) => !before.has(el.id) && el.type === type;
  await expect.poll(async () => (await live(page)).some(isNew)).toBe(true);
  return (await live(page)).find(isNew);
};

const openToolDefaults = async (page: Page) => {
  await page.keyboard.press("ControlOrMeta+Comma");
  await page.getByRole("tab", { name: "Tool defaults" }).click();
  await expect(page.getByTestId("tool-defaults-page")).toBeVisible();
};
const closeSettings = (page: Page) =>
  page.getByRole("button", { name: "Close Settings" }).click();

/** The compact panel: the stroke-style popover, then one of its options. */
const pickStrokeStyle = async (page: Page, title: string) => {
  await page
    .locator("section.selected-shape-actions")
    .getByRole("button", { name: "Stroke" })
    .nth(1)
    .click();
  await page.locator("div.selected-shape-actions").getByTitle(title).click();
};

/** The compact panel: the stroke-colour popover, then a named swatch. */
const pickStrokeColor = async (page: Page, swatch: string) => {
  await page
    .locator("section.selected-shape-actions")
    .getByRole("button", { name: "Stroke" })
    .first()
    .click();
  await page.getByTestId(`color-${swatch}`).first().click();
};

const palette = (page: Page) =>
  page.getByRole("dialog", { name: "Command palette" });

const runCommand = async (page: Page, query: string, title: string) => {
  await page.keyboard.press("ControlOrMeta+Shift+KeyP");
  await expect(palette(page)).toBeVisible();
  await page.keyboard.type(query);
  await expect(palette(page).getByRole("option").first()).toContainText(title);
  return async () => {
    await page.keyboard.press("Enter");
    await expect(palette(page)).toHaveCount(0);
  };
};

const focusCanvas = async (page: Page) => {
  const box = await canvasBox(page);
  await page.mouse.move(box.x + box.width * 0.9, box.y + box.height * 0.95);
};

test.describe.configure({ mode: "serial" });

test.beforeEach(async ({ page }) => {
  await openVault(page);
  await page
    .locator(".vault-tree-item__name", { hasText: "DSA" })
    .first()
    .click();
  await openDrawing(page, "Graphs");
  await focusCanvas(page);
});

test("arrow defaults apply, do not leak, restore on re-pick, reset", async ({
  page,
}, info) => {
  const errors = trackErrors(page);
  await openToolDefaults(page);
  await page
    .getByTestId("tool-default-arrow-stroke_style")
    .selectOption("dotted");
  await page.getByTestId("tool-default-arrow-stroke_width").fill("3");
  await page.getByTestId("tool-default-arrow-stroke_width").press("Enter");
  await page.getByTestId("tool-default-arrow-stroke_color").fill(ORANGE);
  await expect(page.getByTestId("tool-default-arrow-stroke_style")).toHaveValue(
    "dotted",
  );
  await page.getByTestId("tool-default-arrow").scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${SHOTS}/settings-page.png` });
  await closeSettings(page);

  // a. configured arrow
  await focusCanvas(page);
  await page.keyboard.press("a");
  await expectTool(page, "arrow");
  const arrow = await drawAndRead(page, "arrow", 0.3);
  expect(arrow.strokeStyle).toBe("dotted");
  expect(arrow.strokeWidth).toBe(3);
  expect(arrow.strokeColor.toLowerCase()).toBe(ORANGE);

  // b. no leak into the rectangle
  await page.keyboard.press("r");
  await expectTool(page, "rectangle");
  const rect = await drawAndRead(page, "rectangle", 0.5);
  expect(rect.strokeStyle).toBe("solid");
  expect(rect.strokeWidth).toBe(2);
  expect(rect.strokeColor.toLowerCase()).not.toBe(ORANGE);

  // c. a manual change while arrow is active is dropped on re-pick
  await page.keyboard.press("Escape");
  await page.keyboard.press("a");
  await pickStrokeStyle(page, "Solid");
  await page.keyboard.press("r");
  await page.keyboard.press("a");
  await expectTool(page, "arrow");
  const again = await drawAndRead(page, "arrow", 0.7);
  expect(again.strokeStyle).toBe("dotted");
  expect(again.strokeColor.toLowerCase()).toBe(ORANGE);

  // e. reset
  await page.keyboard.press("Escape");
  const run = await runCommand(
    page,
    "Reset Arrow",
    "Tool defaults: Reset Arrow",
  );
  await run();
  await page.keyboard.press("r");
  await page.keyboard.press("a");
  await expectTool(page, "arrow");
  const plain = await drawAndRead(page, "arrow", 0.85, 0.6);
  expect(plain.strokeStyle).toBe("solid");
  expect(plain.strokeWidth).toBe(2);
  expect(plain.strokeColor.toLowerCase()).not.toBe(ORANGE);
  expect(errors).toEqual([]);
  void info;
});

test("save current style from a hand-styled rectangle", async ({ page }) => {
  const errors = trackErrors(page);
  await page.keyboard.press("r");
  const mine = await drawAndRead(page, "rectangle", 0.3);
  const current = async () =>
    (await live(page)).find((e: any) => e.id === mine.id);
  // The new rectangle is selected: style it by hand.
  await pickStrokeStyle(page, "Dashed");
  await pickStrokeColor(page, "red");
  await page.waitForTimeout(AFTER_AUTOSAVE_MS);
  await expect.poll(async () => (await current()).strokeStyle).toBe("dashed");
  const red = (await current()).strokeColor.toLowerCase();
  expect(red).not.toBe("#1e1e1e");

  const run = await runCommand(
    page,
    "Save current style for Rectangle",
    "Tool defaults: Save current style for Rectangle",
  );
  await page.screenshot({ path: `${SHOTS}/palette-save.png` });
  await run();
  await expect(page.locator(".Toast")).toContainText("Saved Rectangle");
  await page.screenshot({ path: `${SHOTS}/saved-toast.png` });

  await page.keyboard.press("Escape");
  await page.keyboard.press("r");
  const second = await drawAndRead(page, "rectangle", 0.6);
  expect(second.strokeStyle).toBe("dashed");
  expect(second.strokeColor.toLowerCase()).toBe(red);
  await page.screenshot({ path: `${SHOTS}/saved-result.png` });

  // Leave the shared global preferences clean for later tests.
  await page.evaluate(() =>
    (window as any).__updatePreferences({ toolRectangle: {} }),
  );
  expect(errors).toEqual([]);
});

test("style application adds no history entries", async ({ page }) => {
  await page.evaluate(() =>
    (window as any).__updatePreferences({
      toolRectangle: { stroke_style: "dashed" },
      toolArrow: { stroke_color: "#f08c00" },
    }),
  );
  for (const key of ["r", "a", "l", "r", "a", "e", "r"]) {
    await page.keyboard.press(key);
  }
  const undo = page
    .locator(".undo-redo-buttons button, [data-testid='button-undo']")
    .first();
  await expect(undo).toBeDisabled();
  const before = (await live(page)).length;
  await page.keyboard.press("ControlOrMeta+KeyZ");
  await page.waitForTimeout(AFTER_AUTOSAVE_MS);
  expect((await live(page)).length).toBe(before);

  // Drawing creates exactly one entry: undo removes the arrow, not styles.
  await page.keyboard.press("a");
  await drawAndRead(page, "arrow", 0.4);
  await page.keyboard.press("ControlOrMeta+KeyZ");
  await expect.poll(async () => (await live(page)).length).toBe(before);
  await page.evaluate(() =>
    (window as any).__updatePreferences({ toolRectangle: {}, toolArrow: {} }),
  );
});

test("pen presets win over a configured tool and leaving freedraw works", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await page.evaluate(() =>
    (window as any).__updatePreferences({
      toolArrow: { stroke_color: "#f08c00", stroke_width: 3 },
    }),
  );
  await page.keyboard.press("a");
  await expectTool(page, "arrow");
  await page.keyboard.press("Alt+Digit1");
  await expectTool(page, "freedraw");
  const pen = page.getByRole("toolbar", { name: "Pens" });
  await expect(pen.locator("button[aria-pressed='true']")).toHaveCount(1);
  const stroke = await drawAndRead(page, "freedraw", 0.4);
  expect(stroke.strokeColor.toLowerCase()).not.toBe(ORANGE);

  await page.keyboard.press("Escape");
  await page.keyboard.press("r");
  const rect = await drawAndRead(page, "rectangle", 0.6);
  expect(rect.strokeColor.toLowerCase()).not.toBe(ORANGE);
  expect(rect.strokeWidth).toBe(2);
  await page.keyboard.press("a");
  const arrow = await drawAndRead(page, "arrow", 0.8);
  expect(arrow.strokeColor.toLowerCase()).toBe(ORANGE);
  await page.evaluate(() =>
    (window as any).__updatePreferences({ toolArrow: {} }),
  );
  expect(errors).toEqual([]);
});
