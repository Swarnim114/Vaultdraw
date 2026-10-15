// Loads a drawing saved by Vaultdraw into a plain Excalidraw editor and
// screenshots it (excalidraw.com compatibility). Heavy: run under the build
// lock from excalidraw-desktop:
//   lockf -k ../.cache/build.lock node compat/run.mjs <drawing.excalidraw> <out.png>
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";
import { createServer } from "vite";

const [fixture, out] = process.argv.slice(2);
if (!fixture || !out) {
  throw new Error("usage: run.mjs <drawing.excalidraw> <out.png>");
}
const server = await createServer({
  configFile: fileURLToPath(
    new URL("../vite.compat.config.mts", import.meta.url),
  ),
  logLevel: "warn",
});
await server.listen();
const browser = await chromium.launch();
try {
  const page = await (
    await browser.newContext({ viewport: { width: 1100, height: 700 } })
  ).newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://localhost:1437/index.html");
  await page.waitForFunction(() => window.api, null, { timeout: 120000 });
  const json = readFileSync(fixture, "utf8");
  const summary = await page.evaluate(async (j) => {
    const lib = window.__lib;
    const scene = await lib.loadFromBlob(new Blob([j]), null, null, null);
    const els = lib.restoreElements(scene.elements, null, {
      refreshDimensions: true,
    });
    window.api.updateScene({ elements: els });
    return els.map((e) => ({ type: e.type, link: e.link, text: e.text }));
  }, json);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: out });
  console.log(JSON.stringify({ errors, summary }, null, 1));
} finally {
  await browser.close();
  await server.close();
}
