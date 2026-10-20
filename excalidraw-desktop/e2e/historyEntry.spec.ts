import { expect, test, type Page } from "@playwright/test";

import { openVault, trackErrors } from "./helpers";
import { panel, rectEl, RED, rows, sceneJson, setup } from "./historyHelpers";

// Visible History entry points (header button, canvas main menu, a drawing's
// row menu). Each dispatches history.toggle, like Mod+Shift+H and the palette.
const button = (page: Page) => page.getByTestId("history-button");
const KEY = /^History \((Cmd\+Shift\+H|Ctrl\+Shift\+H)\)$/;
const V1 = { json: sceneJson([rectEl("a", 40, 40, RED)]) };

test("header button: hidden without a drawing, shows the key, toggles the panel", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await openVault(page);
  await expect(page.locator(".vault-editor canvas.interactive")).toHaveCount(0);
  await expect(button(page)).toHaveCount(0);

  await setup(page, [rectEl("c", 40, 40, RED)], [V1]);
  await expect(button(page)).toBeVisible();
  await expect(button(page)).toHaveAttribute("title", KEY);
  await expect(button(page)).toHaveAttribute("aria-pressed", "false");

  await button(page).click();
  await expect(panel(page)).toBeVisible();
  await expect(rows(page)).toHaveCount(1);
  await expect(button(page)).toHaveAttribute("aria-pressed", "true");

  await button(page).click();
  await expect(panel(page)).toHaveCount(0);
  await expect(button(page)).toHaveAttribute("aria-pressed", "false");

  // The shortcut drives the same state.
  await page.keyboard.press("ControlOrMeta+Shift+KeyH");
  await expect(panel(page)).toBeVisible();
  await expect(button(page)).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("ControlOrMeta+Shift+KeyH");
  await expect(panel(page)).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("canvas main menu History shows the key and opens the panel", async ({
  page,
}) => {
  await setup(page, [rectEl("c", 40, 40, RED)], [V1]);
  await page.getByTestId("main-menu-trigger").click();
  const item = page.getByRole("menuitem", { name: /History/ });
  await expect(item).toContainText(/(Cmd\+Shift\+H|Ctrl\+Shift\+H)/);
  await item.click();
  await expect(panel(page)).toBeVisible();
  await expect(button(page)).toHaveAttribute("aria-pressed", "true");
});

test("row menu History shows the panel, never closes it, and opens other drawings first", async ({
  page,
}) => {
  await setup(page, [rectEl("c", 40, 40, RED)], [V1]);
  const historyItem = () =>
    page.getByRole("menuitem", { name: "History", exact: true });
  const graphs = page
    .locator(".vault-tree-item__name", { hasText: "Graphs" })
    .first();

  await graphs.click({ button: "right" });
  await historyItem().click();
  await expect(panel(page)).toBeVisible();
  await expect(rows(page)).toHaveCount(1);
  // With the panel already open it stays open.
  await graphs.click({ button: "right" });
  await historyItem().click();
  await expect(panel(page)).toBeVisible();
  await button(page).click();
  await expect(panel(page)).toHaveCount(0);

  // Another drawing: it is opened first, then its panel shows.
  await page
    .locator(".vault-tree-item__name", { hasText: "Dynamic Programming" })
    .first()
    .click();
  const intro = page
    .locator(".vault-tree-item__name", { hasText: "01 Introduction" })
    .first();
  await intro.click({ button: "right" });
  await historyItem().click();
  await expect(page.locator(".vault-breadcrumbs__item--active")).toHaveText(
    "01 Introduction",
  );
  await expect(panel(page)).toBeVisible();
  await expect(button(page)).toHaveAttribute("aria-pressed", "true");
});
