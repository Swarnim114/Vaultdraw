import { expect, type Page } from "@playwright/test";

export const SHOTS = "../.cache/e2e-shots";

/** Debug screenshots are only taken in full runs (E2E_FULL=1). */
export const screenshot = async (
  page: Page,
  options: Parameters<Page["screenshot"]>[0],
) => {
  if (process.env.E2E_FULL === "1") {
    await page.screenshot(options);
  }
};

/** Collect console errors / page errors so every spec can assert none occurred. */
export const trackErrors = (page: Page) => {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      errors.push(`console: ${msg.text()}`);
    }
  });
  return errors;
};

export const openVault = async (page: Page, query = "") => {
  await page.goto(`/e2e.html${query}`);
  const onboarding = page.getByRole("button", { name: /Open Vault Folder/ });
  const navigator = page.getByLabel("Vault File Navigator");
  await expect(onboarding.or(navigator).first()).toBeVisible();
  if (await onboarding.isVisible()) {
    await onboarding.click();
  }
  await expect(page.getByLabel("Vault File Navigator")).toBeVisible();
};

export const openDrawing = async (page: Page, name: string) => {
  await page
    .locator(".vault-tree-item__name", { hasText: name })
    .first()
    .click();
  await expect(page.locator(".vault-editor canvas.interactive")).toBeVisible();
  // Excalidraw initializes asynchronously (fonts + initialData promise).
  await page.waitForTimeout(500);
};

/** Read a drawing's JSON straight from the in-memory vault. */
export const readScene = (page: Page, path: string) =>
  page.evaluate(async (p) => {
    const repo = (window as any).__vaultRepo;
    const file = await repo.readDrawing(repo.handle, p);
    return JSON.parse(file.json);
  }, path);

export const canvasBox = async (page: Page) => {
  const box = await page
    .locator(".vault-editor canvas.interactive")
    .boundingBox();
  if (!box) {
    throw new Error("canvas not visible");
  }
  return box;
};

/** Excalidraw's hamburger menu hosts export and vault actions. */
export const clickMainMenuItem = async (page: Page, label: string) => {
  await page.getByTestId("main-menu-trigger").click();
  await page.getByRole("menuitem", { name: label }).click();
};
