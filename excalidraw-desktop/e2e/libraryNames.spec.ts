import { expect, test, type Page } from "@playwright/test";

import { openDrawing, openVault, SHOTS, trackErrors } from "./helpers";

/** A 19-element tree diagram (7 boxes, 6 connectors, 6 labels) with stock
 *  colours, like the one from the manual test. */
const treeItem = (id: string, name?: string) => {
  const els: any[] = [];
  const base = {
    angle: 0,
    strokeColor: "#1e1e1e",
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 2,
    strokeStyle: "solid",
    roughness: 1,
    opacity: 100,
    groupIds: [],
    frameId: null,
    roundness: null,
    version: 1,
    isDeleted: false,
    boundElements: null,
    updated: 1,
    link: null,
    locked: false,
  };
  const nodes = [
    [300, 0],
    [140, 140],
    [460, 140],
    [60, 280],
    [220, 280],
    [380, 280],
    [540, 280],
  ];
  nodes.forEach(([x, y], i) => {
    els.push({
      ...base,
      id: `${id}-n${i}`,
      type: "rectangle",
      x,
      y,
      width: 100,
      height: 60,
      seed: i + 1,
      versionNonce: i + 1,
    });
  });
  const edges = [
    [0, 1],
    [0, 2],
    [1, 3],
    [1, 4],
    [2, 5],
    [2, 6],
  ];
  edges.forEach(([a, b], i) => {
    const [ax, ay] = nodes[a];
    const [bx, by] = nodes[b];
    els.push({
      ...base,
      id: `${id}-e${i}`,
      type: "line",
      x: ax + 50,
      y: ay + 60,
      width: Math.abs(bx - ax),
      height: by - ay - 60,
      points: [
        [0, 0],
        [bx - ax, by - ay - 60],
      ],
      seed: 100 + i,
      versionNonce: 100 + i,
    });
  });
  for (let i = 1; i < 7; i++) {
    const [x, y] = nodes[i];
    els.push({
      ...base,
      id: `${id}-t${i}`,
      type: "text",
      x: x + 38,
      y: y + 18,
      width: 24,
      height: 25,
      text: String(i),
      originalText: String(i),
      fontSize: 20,
      fontFamily: 5,
      textAlign: "center",
      verticalAlign: "top",
      containerId: null,
      lineHeight: 1.25,
      seed: 200 + i,
      versionNonce: 200 + i,
    });
  }
  return {
    id,
    status: "unpublished",
    created: 1,
    ...(name ? { name } : {}),
    elements: els,
  };
};

const rectItem = (id: string, name: string | undefined, color: string) => ({
  id,
  status: "unpublished",
  created: 1,
  ...(name ? { name } : {}),
  elements: [
    {
      ...treeItem("x").elements[0],
      id: `${id}-r`,
      strokeColor: color,
      backgroundColor: "#a5d8ff",
      fillStyle: "hachure",
      width: 120,
      height: 80,
    },
  ],
});

const libJson = (items: unknown[]) =>
  JSON.stringify({
    type: "excalidrawlib",
    version: 2,
    source: "https://excalidraw.com",
    libraryItems: items,
  });

const seedPersonal = (page: Page, items: unknown[]) =>
  page.evaluate((json) => {
    (window as any).__libraryRepo.setFile("personal", json);
  }, libJson(items));

const seedVault = (page: Page, items: unknown[]) =>
  page.evaluate((json) => {
    const handle = (window as any).__vaultRepo.handle;
    (window as any).__libraryRepo.setFile("vault", json, handle);
  }, libJson(items));

const openLibrary = async (page: Page) => {
  if (!(await page.getByTestId("library-section-personal").isVisible())) {
    await page.locator(".default-sidebar-trigger").first().click();
  }
  await expect(page.getByTestId("library-section-personal")).toBeVisible();
};

const setup = async (page: Page, vaultItems: unknown[] = []) => {
  const errors = trackErrors(page);
  await openVault(page);
  await page
    .locator(".vault-tree-item__name", { hasText: "DSA" })
    .first()
    .click();
  await openDrawing(page, "Graphs");
  await seedPersonal(page, [
    treeItem("tree", "Binary tree"),
    rectItem("box", "A box with a rather long name that ellipsizes", "#1971c2"),
    rectItem("plain", undefined, "#e03131"),
  ]);
  if (vaultItems.length) {
    await seedVault(page, vaultItems);
  }
  await openLibrary(page);
  await expect(page.locator(".library-unit svg")).toHaveCount(
    3 + vaultItems.length,
  );
  return errors;
};

const shoot = async (page: Page, name: string) => {
  if (process.env.LIBRARY_SHOTS === "1") {
    await page.waitForTimeout(300);
    await page
      .locator(".default-sidebar")
      .screenshot({ path: `${SHOTS}/library-names-${name}.png` });
  }
};

test("library previews: light, dark, Dracula with sync", async ({ page }) => {
  const errors = await setup(page);
  await shoot(page, "light");

  await page.emulateMedia({ colorScheme: "dark" });
  await page.waitForTimeout(300);
  await shoot(page, "dark");

  await page
    .getByLabel("Vault File Navigator")
    .getByRole("button", { name: "Settings" })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("radio", { name: "Dracula" }).click();
  await dialog.getByRole("switch", { name: /Sync canvas with theme/ }).click();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await openLibrary(page);
  await shoot(page, "dracula-sync");
  expect(errors).toEqual([]);
});

// E2E_PERF=1: 2,000-item library, sidebar open. Previews render lazily, so
// only tiles near the viewport are exported to SVG. Also runs on a baseline
// checkout (generic selectors only).
test.describe("library previews perf", () => {
  test.skip(process.env.E2E_PERF !== "1", "set E2E_PERF=1");
  const runs = Number(process.env.PERF_RUNS ?? 3);
  for (const rate of [1, 6]) {
    for (let run = 1; run <= runs; run++) {
      test(`2,000 items: sidebar open cpu${rate}x run${run}`, async ({
        page,
        browserName,
      }) => {
        test.skip(rate !== 1 && browserName !== "chromium", "CDP throttle");
        await openVault(page);
        await page
          .locator(".vault-tree-item__name", { hasText: "DSA" })
          .first()
          .click();
        await openDrawing(page, "Graphs");
        const items = Array.from({ length: 2000 }, (_, i) =>
          i % 10 === 0
            ? treeItem(`t${i}`, `Tree ${i}`)
            : rectItem(`r${i}`, `Box ${i}`, "#1971c2"),
        );
        await seedPersonal(page, items);
        await page.waitForTimeout(2500);
        await page.evaluate(() => {
          const w = window as any;
          w.__longest = 0;
          w.__longTotal = 0;
          new PerformanceObserver((list) => {
            for (const e of list.getEntries()) {
              w.__longest = Math.max(w.__longest, e.duration);
              w.__longTotal += e.duration;
            }
          }).observe({ type: "longtask", buffered: false } as any);
        });
        const cdp =
          browserName === "chromium"
            ? await page.context().newCDPSession(page)
            : null;
        await cdp?.send("Emulation.setCPUThrottlingRate", { rate });
        const t0 = Date.now();
        await page.locator(".default-sidebar-trigger").first().click();
        await expect(page.locator(".library-unit svg").first()).toBeVisible({
          timeout: 60_000,
        });
        const firstPreviewMs = Date.now() - t0;
        await page.waitForTimeout(rate === 1 ? 3000 : 10000);
        const res = await page.evaluate(() => ({
          svgs: document.querySelectorAll(".library-unit svg").length,
          tiles: document.querySelectorAll(".library-unit").length,
          longest: Math.round((window as any).__longest),
          longTotal: Math.round((window as any).__longTotal),
          heapMB: (performance as any).memory
            ? Math.round((performance as any).memory.usedJSHeapSize / 1e6)
            : null,
        }));
        await cdp?.send("Emulation.setCPUThrottlingRate", { rate: 1 });
        // eslint-disable-next-line no-console
        console.log(
          `PERF_NAMES ${JSON.stringify({
            tag: process.env.PERF_TAG ?? "ours",
            browserName,
            rate,
            run,
            firstPreviewMs,
            ...res,
          })}`,
        );
      });
    }
  }
});
