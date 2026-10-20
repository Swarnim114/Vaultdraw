import { expect, test, type Page } from "@playwright/test";

import { runPaletteCommand } from "./historyHelpers";
import { openVault, trackErrors } from "./helpers";

// Settings scope: one Global | This vault switch for every per-vault setting
// (personal/feature/settings-scope/PLAN.md). Browser harness: global prefs live
// in localStorage, per-vault overrides in the in-memory vault settings.
const PREFS_KEY = "excalidraw-vault-preferences-v1";

const anyDialog = (page: Page) => page.getByRole("dialog");
const row = (page: Page, id: string) =>
  anyDialog(page).locator(`[data-setting-id="${id}"]`);
const scopeGroup = (page: Page) =>
  anyDialog(page).getByRole("radiogroup", { name: "Settings scope" });
const radio = (page: Page, name: "Global" | "This vault") =>
  scopeGroup(page).getByRole("radio", { name });

const openSettings = async (page: Page) => {
  await page.keyboard.press("ControlOrMeta+Comma");
  await expect(anyDialog(page)).toBeVisible();
};
const closeSettings = async (page: Page) => {
  await anyDialog(page).getByRole("button", { name: "Close Settings" }).click();
  await expect(anyDialog(page)).toHaveCount(0);
};
const gotoTab = (page: Page, name: string) =>
  anyDialog(page).getByRole("tab", { name, exact: true }).click();
const setScope = async (page: Page, name: "Global" | "This vault") => {
  await radio(page, name).click();
  await expect(radio(page, name)).toBeChecked();
};
const openHistory = async (page: Page) => {
  await gotoTab(page, "History");
  await expect(page.getByTestId("history-settings-page")).toBeVisible();
};
const prefs = (page: Page) =>
  page.evaluate(
    (key) => JSON.parse(window.localStorage.getItem(key) ?? "{}"),
    PREFS_KEY,
  );
const spin = (page: Page, id: string) => row(page, id).getByRole("spinbutton");

/** Moves a stepper to `target` with its keyboard (PageUp/Down x5, then arrows). */
const setNumber = async (page: Page, id: string, target: number) => {
  const input = spin(page, id);
  await input.focus();
  const now = Number(await input.getAttribute("aria-valuenow"));
  const steps = target - now;
  const key = steps > 0 ? "Up" : "Down";
  const n = Math.abs(steps);
  for (let i = 0; i < Math.floor(n / 5); i++) {
    await input.press(`Page${key}`);
  }
  for (let i = 0; i < n % 5; i++) {
    await input.press(`Arrow${key}`);
  }
  await expect(input).toHaveAttribute("aria-valuenow", String(target));
};

const resetBtn = (page: Page, id: string) =>
  row(page, id).getByRole("button", { name: /^Reset .* to global$/ });

test.describe("settings scope", () => {
  test.beforeEach(async ({ page }) => {
    await openVault(page);
  });

  test("scope switch: radios, default Global, arrow keys", async ({ page }) => {
    const errors = trackErrors(page);
    await openSettings(page);
    await expect(scopeGroup(page)).toBeVisible();
    await expect(page.getByTestId("settings-scope")).toBeVisible();
    await expect(scopeGroup(page).getByRole("radio")).toHaveCount(2);
    await expect(radio(page, "Global")).toBeChecked();
    await expect(radio(page, "This vault")).not.toBeChecked();

    await radio(page, "Global").focus();
    await page.keyboard.press("ArrowRight");
    await expect(radio(page, "This vault")).toBeChecked();
    await page.keyboard.press("ArrowLeft");
    await expect(radio(page, "Global")).toBeChecked();
    expect(errors).toEqual([]);
  });

  test("scope switch is hidden when no vault is open", async ({ page }) => {
    // The harness always opens a vault and the onboarding screen has no
    // Settings dialog; close the vault if the app offers a way to do so.
    test.skip(true, "browser harness cannot show Settings without a vault");
    void page;
  });

  test("inherited: This vault shows the global value dimmed with a badge", async ({
    page,
  }) => {
    await openSettings(page);
    await openHistory(page);
    await setScope(page, "This vault");
    const r = row(page, "history-interval");
    await expect(r).toHaveAttribute("data-scope-state", "inherited");
    await expect(r).toContainText("Inherited from global");
    await expect(spin(page, "history-interval")).toHaveAttribute(
      "aria-valuenow",
      "5",
    );
    await expect(resetBtn(page, "history-interval")).toHaveCount(0);
  });

  test("override, reset, and the vault edit never touches global", async ({
    page,
  }) => {
    const errors = trackErrors(page);
    await openSettings(page);
    await openHistory(page);
    await setScope(page, "This vault");
    await setNumber(page, "history-interval", 12);

    const r = row(page, "history-interval");
    await expect(r).toHaveAttribute("data-scope-state", "overridden");
    await expect(r).toContainText("Overridden");
    const reset = r.getByRole("button", {
      name: /^Reset Version interval.* to global$/,
    });
    await expect(reset).toBeVisible();
    // Global prefs are untouched by the vault edit.
    expect((await prefs(page)).historyIntervalMinutes).not.toBe(12);

    await setScope(page, "Global");
    await expect(spin(page, "history-interval")).toHaveAttribute(
      "aria-valuenow",
      "5",
    );
    await expect(r).toHaveAttribute("data-vault-override", "true");
    await expect(r).toContainText("This vault overrides this");
    expect((await prefs(page)).historyIntervalMinutes).not.toBe(12);

    // Other rows have no override note.
    await expect(row(page, "history-keep-all")).not.toHaveAttribute(
      "data-vault-override",
      "true",
    );

    // Reset to global -> inherited again with the global value.
    await setScope(page, "This vault");
    await expect(r).toHaveAttribute("data-scope-state", "overridden");
    await expect(spin(page, "history-interval")).toHaveAttribute(
      "aria-valuenow",
      "12",
    );
    await resetBtn(page, "history-interval").click();
    await expect(r).toHaveAttribute("data-scope-state", "inherited");
    await expect(r).toContainText("Inherited from global");
    await expect(spin(page, "history-interval")).toHaveAttribute(
      "aria-valuenow",
      "5",
    );
    await expect(resetBtn(page, "history-interval")).toHaveCount(0);
    await setScope(page, "Global");
    await expect(r).not.toHaveAttribute("data-vault-override", "true");
    expect(errors).toEqual([]);
  });

  test("global change propagates to the vault scope when not overridden", async ({
    page,
  }) => {
    await openSettings(page);
    await openHistory(page);
    await setScope(page, "Global");
    await setNumber(page, "history-interval", 20);
    await expect
      .poll(async () => (await prefs(page)).historyIntervalMinutes)
      .toBe(20);
    await setScope(page, "This vault");
    const r = row(page, "history-interval");
    await expect(r).toHaveAttribute("data-scope-state", "inherited");
    await expect(spin(page, "history-interval")).toHaveAttribute(
      "aria-valuenow",
      "20",
    );
  });

  test("vault scope lists only per-vault pages", async ({ page }) => {
    await openSettings(page);
    await setScope(page, "Global");
    for (const name of ["Appearance", "Hotkeys", "History", "Tools"]) {
      await expect(
        anyDialog(page).getByRole("tab", { name, exact: true }),
      ).toBeVisible();
    }
    await setScope(page, "This vault");
    for (const name of [
      "History",
      "Files",
      "Interface",
      "Appearance",
      "Tools",
    ]) {
      await expect(
        anyDialog(page).getByRole("tab", { name, exact: true }),
      ).toBeVisible();
    }
    // Appearance stays only for its per-vault Canvas pattern (paper) row.
    await gotoTab(page, "Appearance");
    await expect(row(page, "paper")).toBeVisible();
    await expect(row(page, "colour-theme")).toHaveCount(0);
    for (const name of ["Drawing", "Hotkeys", "Links"]) {
      await expect(
        anyDialog(page).getByRole("tab", { name, exact: true }),
      ).toHaveCount(0);
    }
  });

  test("Tools page in vault scope: no Pen/Laser, Text inherit/override/reset", async ({
    page,
  }) => {
    const errors = trackErrors(page);
    await openSettings(page);
    await gotoTab(page, "Tools");
    const tools = anyDialog(page).getByRole("tablist", { name: "Tools" });
    await expect(tools.getByRole("tab", { name: "Pen" })).toBeVisible();
    await expect(tools.getByRole("tab", { name: "Laser" })).toBeVisible();

    await setScope(page, "This vault");
    await expect(tools.getByRole("tab", { name: "Pen" })).toHaveCount(0);
    await expect(tools.getByRole("tab", { name: "Laser" })).toHaveCount(0);
    await tools.getByRole("tab", { name: "Text" }).click();
    const section = page.getByTestId("tool-default-text");
    await expect(section).toBeVisible();
    await expect(section).toContainText("Inherited from global");
    const reset = section.getByRole("button", { name: "Reset Text to global" });
    await expect(reset).toHaveCount(0);

    await page.getByTestId("tool-default-text-stroke_color").fill("#f08c00");
    await expect(section).toContainText("Overridden");
    await expect(reset).toBeVisible();

    // Global scope shows the unchanged global style (no orange) and the note.
    await setScope(page, "Global");
    await tools.getByRole("tab", { name: "Text" }).click();
    await expect(section).toContainText("This vault overrides this");
    expect((await prefs(page)).toolTextStrokeColor ?? null).not.toBe("#f08c00");

    await setScope(page, "This vault");
    await tools.getByRole("tab", { name: "Text" }).click();
    await reset.click();
    await expect(section).toContainText("Inherited from global");
    await expect(reset).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test("scope is remembered across close and reopen", async ({ page }) => {
    await openSettings(page);
    await setScope(page, "This vault");
    await closeSettings(page);
    await openSettings(page);
    await expect(radio(page, "This vault")).toBeChecked();
    await setScope(page, "Global");
    await closeSettings(page);
    await openSettings(page);
    await expect(radio(page, "Global")).toBeChecked();
  });

  test("palette commands open Settings in the requested scope", async ({
    page,
  }) => {
    await runPaletteCommand(page, "Settings: Edit this vault's settings");
    await expect(anyDialog(page)).toBeVisible();
    await expect(radio(page, "This vault")).toBeChecked();
    await closeSettings(page);

    await runPaletteCommand(page, "Settings: Edit global settings");
    await expect(anyDialog(page)).toBeVisible();
    await expect(radio(page, "Global")).toBeChecked();
  });

  test("no per-row 'This vault' switch anywhere in Settings", async ({
    page,
  }) => {
    await openSettings(page);
    for (const scope of ["Global", "This vault"] as const) {
      await setScope(page, scope);
      const tabs = await anyDialog(page).getByRole("tab").allInnerTexts();
      for (const name of tabs) {
        await gotoTab(page, name.trim());
        await expect(
          anyDialog(page).getByRole("switch", { name: /This vault/ }),
        ).toHaveCount(0);
      }
    }
  });
});
