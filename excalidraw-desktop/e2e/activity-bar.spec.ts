import { expect, test, type Page } from "@playwright/test";

import { openDrawing, trackErrors } from "./helpers";
import { panel as historyPanel } from "./historyHelpers";
import { openTagsVault, searchBox, tagsPanel } from "./tagsHelpers";

// The activity bar, reached only by clicking its visible buttons (one
// click-through test per feature): each entry opens what the user expects.
const entry = (page: Page, id: string) =>
  page.getByTestId(`activity-bar-${id}`);
const pressed = (page: Page, id: string, on: boolean) =>
  expect(entry(page, id)).toHaveAttribute(
    "aria-pressed",
    on ? "true" : "false",
  );
const library = (page: Page) => page.locator(".default-sidebar");
const settings = (page: Page) => page.locator(".vault-settings-modal");

test("activity bar: every entry opens its panel, view or dialog", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await openTagsVault(page);
  await expect(page.getByTestId("activity-bar")).toBeVisible();
  await expect(
    page
      .getByLabel("Vault File Navigator")
      .getByRole("button", { name: "Graph view", exact: true }),
  ).toHaveCount(0);

  // No drawing open: Library and History are disabled with the reason.
  for (const [id, label] of [
    ["library", "Library"],
    ["history", "History"],
  ]) {
    await expect(entry(page, id)).toHaveAttribute("aria-disabled", "true");
    await expect(entry(page, id)).toHaveAttribute(
      "title",
      new RegExp(`^${label}.*Open a drawing first`),
    );
  }
  await entry(page, "history").click({ force: true });
  await expect(historyPanel(page)).toHaveCount(0);

  await openDrawing(page, "Graphs");
  await expect(entry(page, "library")).not.toHaveAttribute(
    "aria-disabled",
    "true",
  );
  await expect(entry(page, "history")).not.toHaveAttribute(
    "aria-disabled",
    "true",
  );

  // Tooltip carries the shortcut of an entry with a default key.
  await expect(entry(page, "graph")).toHaveAttribute(
    "title",
    /^Graph view \((Cmd\+Option\+G|Ctrl\+Alt\+G)\)$/,
  );

  // Library sidebar.
  await pressed(page, "library", false);
  await entry(page, "library").click();
  await expect(library(page)).toBeVisible();
  await pressed(page, "library", true);
  await entry(page, "library").click();
  await expect(library(page)).toBeHidden();
  await pressed(page, "library", false);

  // History panel.
  await entry(page, "history").click();
  await expect(historyPanel(page)).toBeVisible();
  await pressed(page, "history", true);
  await entry(page, "history").click();
  await expect(historyPanel(page)).toHaveCount(0);
  await pressed(page, "history", false);

  // Graph view.
  await entry(page, "graph").click();
  await expect(page.getByTestId("graph-view")).toBeVisible();
  await pressed(page, "graph", true);
  await entry(page, "graph").click();
  await expect(page.getByTestId("graph-view")).toHaveCount(0);
  await pressed(page, "graph", false);

  // Gallery.
  await entry(page, "gallery").click();
  await expect(page.getByTestId("gallery-view")).toBeVisible();
  await pressed(page, "gallery", true);
  // The gallery command opens (it does not toggle); Escape closes it.
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("gallery-view")).toHaveCount(0);
  await pressed(page, "gallery", false);

  // Search focuses the navigator's search box.
  await entry(page, "search").click();
  await expect(searchBox(page)).toBeFocused();

  // Tags shows the Tags pane and moves focus into it.
  await entry(page, "tags").click();
  await expect(tagsPanel(page)).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          !!document.activeElement?.closest('[aria-label="Tags"], .vault-tags'),
      ),
    )
    .toBe(true);

  // Templates picker.
  await entry(page, "templates").click();
  const picker = page.getByRole("dialog", {
    name: "New drawing from template",
  });
  await expect(picker).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(picker).toHaveCount(0);

  // Hotkeys settings page, then the settings modal.
  await entry(page, "hotkeys").click();
  await expect(settings(page)).toBeVisible();
  await expect(page.getByRole("tab", { name: "Hotkeys" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.keyboard.press("Escape");
  await expect(settings(page)).toHaveCount(0);

  await entry(page, "settings").click();
  await expect(settings(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(settings(page)).toHaveCount(0);

  expect(errors).toEqual([]);
});
