import { expect, test } from "@playwright/test";

import { openVault, trackErrors } from "./helpers";

test("navigator can be resized and remembers its width", async ({ page }) => {
  const errors = trackErrors(page);
  await openVault(page);
  const nav = page.getByLabel("Vault File Navigator");
  const before = (await nav.boundingBox())!.width;
  const handle = page.getByRole("separator", { name: "Resize navigator" });
  const box = (await handle.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + 200);
  await page.mouse.down();
  await page.mouse.move(box.x - 80, box.y + 200, { steps: 8 });
  await page.mouse.up();
  const after = (await nav.boundingBox())!.width;
  expect(after).toBeGreaterThan(before + 60);

  // Persisted for the next launch. (A page reload is avoided: WebKit cancels
  // Vite's unbundled dev-module requests on reload, a dev-server artifact.)
  await expect
    .poll(() =>
      page.evaluate(() => {
        for (let i = 0; i < localStorage.length; i++) {
          const raw = localStorage.getItem(localStorage.key(i)!) ?? "";
          if (raw.includes("navigatorWidth")) {
            return JSON.parse(raw).navigatorWidth;
          }
        }
        return null;
      }),
    )
    .toBeCloseTo(after, -1);
  expect(errors).toEqual([]);
});

test("navigator collapse toggle hides and restores the tree", async ({
  page,
}) => {
  await openVault(page);
  await page.getByRole("button", { name: "Hide Navigator" }).click();
  await expect
    .poll(
      async () =>
        (
          await page
            .getByLabel("Vault File Navigator", { exact: true })
            .boundingBox()
        )?.width ?? 0,
    )
    .toBeLessThan(2);
  await page.getByRole("button", { name: "Show Navigator" }).click();
  await expect(page.locator(".vault-tree-item").first()).toBeVisible();
});

test("vault home lists recent drawings and opens them", async ({ page }) => {
  const errors = trackErrors(page);
  await openVault(page);
  const recent = page.getByRole("region", { name: "Recent drawings" });
  await expect(recent.getByRole("button")).toHaveCount(2);
  await recent.getByRole("button", { name: /Graphs/ }).click();
  await expect(page.locator(".vault-editor canvas.interactive")).toBeVisible();
  await expect(page.getByLabel("Breadcrumb")).toContainText("Graphs");
  expect(errors).toEqual([]);
});
