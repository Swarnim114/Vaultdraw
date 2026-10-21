import { expect, test } from "@playwright/test";

import {
  A,
  B,
  PAIR,
  activeTab,
  clickTree,
  expectShown,
  mounted,
  onScreenIds,
  openSeededVault,
  tabByName,
  tabEls,
  tabNames,
  trackErrors,
  zoomLabel,
} from "./tabsHelpers";

// The ONE visible-UI tabs test (clicks only: no shortcut, no palette). The
// keyboard / behaviour cases live in tabsKeys.spec.ts.
test("tabs: click two drawings into two tabs, click the first tab, its shapes and zoom are back", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await openSeededVault(page, PAIR);

  // Drawing A in the first tab, zoomed in with the on-screen zoom button.
  await clickTree(page, A);
  await expectShown(page, ["a-rect"]);
  await expect(zoomLabel(page)).toContainText("100%");
  await page.locator(".vault-editor .zoom-in-button").click();
  await page.locator(".vault-editor .zoom-in-button").click();
  await expect(zoomLabel(page)).not.toContainText("100%");
  const zoomA = (await zoomLabel(page).innerText()).trim();
  expect(zoomA).toMatch(/^\d+%$/);
  expect(await tabNames(page)).toEqual([A]);

  // "+" opens a new home tab; a navigator click then opens B in that tab.
  await page.getByTestId("vault-tab-new").click();
  await expect(tabEls(page)).toHaveCount(2);
  await clickTree(page, B);
  await expectShown(page, ["b-ellipse"]);

  expect(await tabNames(page)).toEqual([A, B]);
  expect(await activeTab(page)).toBe(B);
  await expect(tabByName(page, B)).toHaveAttribute("aria-selected", "true");
  await expect(tabByName(page, A)).toHaveAttribute("aria-selected", "false");
  expect(await onScreenIds(page)).toEqual(["b-ellipse"]);
  await expect(zoomLabel(page)).toContainText("100%");
  // A background tab holds data only: one live canvas pair, no second editor.
  expect(await mounted(page)).toBe(1);

  // Back to A: its shape is on screen again at the zoom the user set.
  await tabByName(page, A).click();
  await expectShown(page, ["a-rect"]);
  await expect(tabByName(page, A)).toHaveAttribute("aria-selected", "true");
  expect(await onScreenIds(page)).toEqual(["a-rect"]);
  await expect(zoomLabel(page)).toHaveText(zoomA);
  expect(errors).toEqual([]);
});
