import { expect, test, type Page } from "@playwright/test";

import { openVault } from "./helpers";

// Screenshot helper (not assertions). Runs only with SCOPE_SHOTS=1.
// Works on the old UI (before) and the scoped UI (after).
const OUT =
  process.env.SCOPE_SHOTS_DIR ??
  "/Users/kalon/Opensource/excalidraw/personal/feature/settings-scope/shots";
const PHASE = process.env.SCOPE_PHASE ?? "after";

const openSettings = async (page: Page) => {
  await page.keyboard.press("ControlOrMeta+Comma");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  return dialog;
};

const setScope = async (page: Page, name: "Global" | "This vault") => {
  const radio = page
    .getByRole("radiogroup", { name: "Settings scope" })
    .getByRole("radio", { name });
  await radio.click();
  await expect(radio).toBeChecked();
};

const shot = async (page: Page, name: string) => {
  await page.waitForTimeout(400);
  await page
    .getByRole("dialog")
    .screenshot({ path: `${OUT}/${name}.png`, animations: "disabled" });
};

const openTextTool = async (page: Page) => {
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("tab", { name: "Tools", exact: true }).click();
  await dialog
    .getByRole("tablist", { name: "Tools" })
    .getByRole("tab", { name: "Text" })
    .click();
  await expect(page.getByTestId("tool-default-text")).toBeVisible();
};

test("settings scope screenshots", async ({ page }) => {
  test.skip(process.env.SCOPE_SHOTS !== "1", "set SCOPE_SHOTS=1");
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.emulateMedia({ colorScheme: "light" });
  await openVault(page);
  const dialog = await openSettings(page);
  await dialog.getByRole("tab", { name: "History" }).click();
  await expect(page.getByTestId("history-settings-page")).toBeVisible();

  if (PHASE === "before") {
    await shot(page, "before-history");
    await openTextTool(page);
    await shot(page, "before-tools");
    return;
  }

  await shot(page, "after-history-global");
  await setScope(page, "This vault");
  const interval = dialog
    .locator('[data-setting-id="history-interval"]')
    .getByRole("spinbutton");
  await interval.focus();
  await interval.press("PageUp");
  await interval.press("ArrowUp");
  await expect(
    dialog.locator('[data-setting-id="history-interval"]'),
  ).toHaveAttribute("data-scope-state", "overridden");
  await shot(page, "after-history-vault");
  await openTextTool(page);
  await shot(page, "after-tools-vault");
});
