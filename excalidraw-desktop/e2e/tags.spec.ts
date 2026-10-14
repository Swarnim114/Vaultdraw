import { expect, test, type Page } from "@playwright/test";

import { openVault, trackErrors } from "./helpers";

const searchBox = (page: Page) =>
  page.getByPlaceholder("Search drawings and text… (tag:#name)");
const panel = (page: Page) => page.getByRole("region", { name: "Tags" });
const tagButton = (page: Page, name: string) =>
  panel(page).getByRole("button", { name: new RegExp(`^Tag ${name},`) });
const drawingRow = (page: Page, name: string) =>
  page
    .locator('.vault-search-row[data-kind="drawing"]')
    .filter({ hasText: name });
const chip = (page: Page, name: string) =>
  page.getByRole("button", { name: `Filter by tag ${name}`, exact: true });

test.beforeEach(async ({ page }) => {
  await openVault(page, "?seed=tags");
  // Tree rows are only visible once the DSA folder is open.
  await page
    .locator(".vault-tree-item__name", { hasText: "DSA" })
    .first()
    .click();
  await expect(panel(page)).toBeVisible();
});

test("Tags panel shows nested tags with counts and collapses", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await expect(tagButton(page, "dsa")).toHaveAttribute(
    "aria-label",
    "Tag dsa, 2 drawings",
  );
  await expect(tagButton(page, "dsa/graphs")).toHaveAttribute(
    "aria-label",
    "Tag dsa/graphs, 1 drawing",
  );
  await expect(tagButton(page, "Interview")).toBeVisible();

  await panel(page).getByRole("button", { name: "Collapse dsa" }).click();
  await expect(tagButton(page, "dsa/graphs")).toHaveCount(0);
  await panel(page).getByRole("button", { name: "Expand dsa" }).click();
  await expect(tagButton(page, "dsa/graphs")).toBeVisible();

  await panel(page).getByRole("button", { name: "Tags", exact: true }).click();
  await expect(tagButton(page, "dsa")).toHaveCount(0);
  await panel(page).getByRole("button", { name: "Tags", exact: true }).click();
  await expect(tagButton(page, "dsa")).toBeVisible();
  expect(errors).toEqual([]);
});

test("clicking a tag filters drawings; clearing the search restores the tree", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await tagButton(page, "dsa").click();
  await expect(searchBox(page)).toHaveValue("tag:#dsa");
  await expect(drawingRow(page, "Tagged Graphs")).toBeVisible();
  await expect(drawingRow(page, "Tagged Arrays")).toBeVisible();
  await expect(drawingRow(page, "Not Tags")).toHaveCount(0);
  // The panel is hidden while a search is active (by design).
  await expect(panel(page)).toHaveCount(0);

  await page.getByRole("button", { name: "Clear search" }).click();
  await expect(searchBox(page)).toHaveValue("");
  await expect(drawingRow(page, "Tagged Graphs")).toHaveCount(0);
  await expect(tagButton(page, "dsa")).toHaveAttribute("aria-pressed", "false");

  await tagButton(page, "dsa/graphs").click();
  await expect(searchBox(page)).toHaveValue("tag:#dsa/graphs");
  await expect(drawingRow(page, "Tagged Graphs")).toBeVisible();
  await expect(drawingRow(page, "Tagged Arrays")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("tag chips show on tree rows and clicking one filters", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await expect(chip(page, "dsa/graphs")).toBeVisible();
  await expect(chip(page, "Interview")).toBeVisible();
  await expect(chip(page, "dsa")).toBeVisible();

  await chip(page, "Interview").click();
  await expect(searchBox(page)).toHaveValue("tag:#interview");
  await expect(drawingRow(page, "Tagged Graphs")).toBeVisible();
  await expect(drawingRow(page, "Tagged Arrays")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("typing 'tag:#dsa graph' combines the tag filter with text", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await searchBox(page).fill("tag:#dsa graph");
  await expect(drawingRow(page, "Tagged Graphs")).toBeVisible();
  await expect(drawingRow(page, "Tagged Arrays")).toHaveCount(0);
  await expect(drawingRow(page, "Not Tags")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("URL fragments and hex colours are not tags", async ({ page }) => {
  const errors = trackErrors(page);
  await expect(tagButton(page, "dsa")).toBeVisible();
  for (const bad of ["frag", "ff00aa"]) {
    await expect(tagButton(page, bad)).toHaveCount(0);
    await expect(chip(page, bad)).toHaveCount(0);
  }
  await searchBox(page).fill("tag:#frag");
  await expect(page.locator(".vault-search-row")).toHaveCount(0);
  await searchBox(page).fill("tag:#ff00aa");
  await expect(page.locator(".vault-search-row")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("turning off tag chips in Settings hides them", async ({ page }) => {
  const errors = trackErrors(page);
  await expect(chip(page, "Interview")).toBeVisible();
  await page
    .getByLabel("Vault File Navigator")
    .getByRole("button", { name: "Settings" })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  const toggle = dialog.getByRole("switch", {
    name: /Show tag chips in the file tree/,
  });
  if (!(await toggle.isVisible())) {
    await dialog.getByRole("tab", { name: "Interface" }).click();
  }
  await expect(toggle).toBeChecked();
  await toggle.click();
  await expect(toggle).not.toBeChecked();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(chip(page, "Interview")).toHaveCount(0);
  // The Tags panel itself stays.
  await expect(tagButton(page, "Interview")).toBeVisible();
  expect(errors).toEqual([]);
});
