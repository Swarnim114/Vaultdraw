import { expect, test, type Page } from "@playwright/test";

import { openVault, trackErrors } from "./helpers";
import { panel, rectEl, RED, rows, sceneJson, setup } from "./historyHelpers";

// Visible History entry points (header button, canvas main menu, a drawing's
// row menu), all dispatching history.toggle like Mod+Shift+H and the palette.
// One click-through test per feature (handbook); the row menu item is covered
// by src/tests/historyEntry.test.tsx.
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

  // The canvas main menu item shows the same key and opens the panel too.
  await page.getByTestId("main-menu-trigger").click();
  const item = page.getByRole("menuitem", { name: /History/ });
  await expect(item).toContainText(/(Cmd\+Shift\+H|Ctrl\+Shift\+H)/);
  await item.click();
  await expect(panel(page)).toBeVisible();
  await expect(button(page)).toHaveAttribute("aria-pressed", "true");
  expect(errors).toEqual([]);
});
