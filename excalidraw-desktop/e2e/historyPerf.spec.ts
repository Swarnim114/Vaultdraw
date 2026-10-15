import { expect, test, type Page } from "@playwright/test";

import { canvasBox, openDrawing, openVault } from "./helpers";

// File history main-thread cost (E2E_PERF=1, chromium for CDP task time).
//   history.mainThread.checkpoint  ms of main-thread task time from pressing Enter
//                                  in the checkpoint dialog until it is confirmed,
//                                  with nothing pending to flush (a save came first).
//   history.mainThread.autoVersion count of history IPC calls during 10 autosaves
//                                  (must be 0).
const PERF = process.env.E2E_PERF === "1";
const RUNS = 15;
const AUTOSAVES = 10;

test.skip(!PERF, "set E2E_PERF=1 to run the history measurements");
test.describe.configure({ timeout: 240_000 });

const writeCount = (page: Page) =>
  page.evaluate(() => (window as any).__vaultRepo.writeCalls.length as number);

const drawRectangle = async (page: Page, n: number) => {
  const box = await canvasBox(page);
  await page.locator(".vault-editor [data-testid='toolbar-rectangle']").click();
  const x0 = box.x + box.width * 0.2 + (n % 8) * 30;
  const y0 = box.y + box.height * 0.6 + (n % 5) * 10;
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  await page.mouse.move(x0 + 40, y0 + 30, { steps: 3 });
  await page.mouse.up();
  await page.keyboard.press("1");
};

const nextSave = async (page: Page, action: () => Promise<void>) => {
  const before = await writeCount(page);
  await action();
  await expect
    .poll(() => writeCount(page), { timeout: 8000 })
    .toBeGreaterThan(before);
};

const stats = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q: number) =>
    sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  return {
    p50: +at(0.5).toFixed(2),
    p95: +at(0.95).toFixed(2),
    max: +sorted[sorted.length - 1].toFixed(2),
    n: values.length,
  };
};

const report = (row: Record<string, unknown>) =>
  // eslint-disable-next-line no-console
  console.log(`PERF ${JSON.stringify(row)}`);

test("history main-thread cost: checkpoint and automatic versions", async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "CDP task time is chromium only");
  await openVault(page);
  await page
    .locator(".vault-tree-item__name", { hasText: "DSA" })
    .first()
    .click();
  await openDrawing(page, "Graphs");
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Performance.enable");
  const task = async () =>
    (await cdp.send("Performance.getMetrics")).metrics.find(
      (m) => m.name === "TaskDuration",
    )!.value * 1000;

  // Automatic versions: zero history IPC while autosaving.
  const callsBefore = await page.evaluate(
    () => (window as any).__historyRepo.calls.length as number,
  );
  for (let i = 0; i < AUTOSAVES; i++) {
    await nextSave(page, () => drawRectangle(page, i));
  }
  const callsAfter = await page.evaluate(
    () => (window as any).__historyRepo.calls.length as number,
  );
  const autoCalls = callsAfter - callsBefore;
  report({
    metric: "history.mainThread.autoVersion",
    unit: "count",
    p50: autoCalls,
    p95: autoCalls,
    max: autoCalls,
    n: AUTOSAVES,
    browser: browserName,
    throttle: 1,
  });
  expect(autoCalls).toBe(0);

  // Checkpoint: nothing is pending, so the flush is a no-op.
  const samples: number[] = [];
  for (let i = 0; i < RUNS; i++) {
    await page.keyboard.press("ControlOrMeta+Alt+KeyS");
    const dialog = page.getByRole("dialog", { name: "Create checkpoint" });
    await dialog.getByLabel("Name").fill(`perf ${i}`);
    await page.waitForTimeout(150);
    const before = await task();
    await dialog.getByLabel("Name").press("Enter");
    await expect(page.locator(".vault-history-toast")).toContainText(
      `perf ${i}`,
    );
    samples.push((await task()) - before);
    await expect(dialog).toHaveCount(0);
    await page.waitForTimeout(100);
  }
  const row = stats(samples);
  report({
    metric: "history.mainThread.checkpoint",
    unit: "ms",
    ...row,
    browser: browserName,
    throttle: 1,
  });
});
