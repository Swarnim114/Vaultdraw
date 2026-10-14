/**
 * Packaged-app smoke for pen presets, the highlighter and the laser (F17).
 * Called from runDesktopSmoke while a drawing with a (transparent) rectangle is
 * open. Writes [pens]/[laser] to config.toml, checks the pen bar and laser pick
 * them up, draws one highlighter stroke, asserts it is saved below the
 * rectangle, then undoes it and restores the default config.
 */
import { getPreferences } from "../vault/preferences";
import { getSettingsStatus } from "../vault/settingsSync";

import type { PenPreset } from "../pens/penPresets";

export type PensSmokeContext = {
  root: HTMLElement;
  doc: Document;
  win: Window & typeof globalThis;
  handle: string;
  /** Vault-relative path of the open drawing. */
  path: string;
  step: <T>(name: string, work: () => Promise<T>) => Promise<T>;
  waitFor: <T>(
    label: string,
    read: () => T | null | undefined,
    ms?: number,
  ) => Promise<T>;
  invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown>;
};

type SceneEl = {
  id: string;
  type: string;
  isDeleted?: boolean;
  strokeColor?: string;
  opacity?: number;
};

const SMOKE_PRESETS: PenPreset[] = [
  {
    name: "Smoke ink",
    color: "#2f9e44",
    width: 2,
    opacity: 100,
    pressure: false,
    smoothing: 0.5,
    highlighter: false,
  },
  {
    name: "Smoke highlighter",
    color: "#fab005",
    width: 12,
    opacity: 40,
    pressure: false,
    smoothing: 0.5,
    highlighter: true,
  },
];
const LASER_COLOR = "#1971c2";
const CONFIG_KEYS = ["pens.presets", "laser.color", "laser.size"];

export async function runPensSmoke(ctx: PensSmokeContext) {
  const { root, doc, win, handle, path, step, waitFor, invoke } = ctx;
  const sleep = (ms: number) =>
    new Promise<void>((resolve) => win.setTimeout(resolve, ms));
  const key = (k: string, mod = false) =>
    doc.dispatchEvent(
      new win.KeyboardEvent("keydown", {
        key: k,
        metaKey: mod,
        ctrlKey: mod,
        bubbles: true,
        cancelable: true,
      }),
    );
  const readLive = async () => {
    const read = (await invoke("read_drawing", {
      handle,
      path,
      knownRevision: null,
    })) as { json: string };
    return ((JSON.parse(read.json).elements ?? []) as SceneEl[]).filter(
      (e) => !e.isDeleted,
    );
  };
  /** Cmd+S until `done` holds for the saved scene. */
  const saveUntil = async (
    label: string,
    done: (els: SceneEl[]) => boolean,
  ) => {
    const until = win.performance.now() + 8000;
    for (;;) {
      key("s", true);
      await sleep(1200);
      const live = await readLive();
      if (done(live)) {
        return live;
      }
      if (win.performance.now() > until) {
        throw new Error(`Timed out waiting for the saved scene: ${label}`);
      }
    }
  };
  const canvas = () =>
    root.querySelector<HTMLCanvasElement>(".vault-editor canvas.interactive");
  /** A short synthetic pointer stroke across the middle of the canvas. */
  const stroke = async (fy: number, onMove?: () => void) => {
    const el = await waitFor("interactive canvas", canvas, 5000);
    const b = el.getBoundingClientRect();
    const send = (type: string, x: number, y: number, buttons: number) =>
      el.dispatchEvent(
        new win.PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          pointerId: 1,
          pointerType: "mouse",
          isPrimary: true,
          button: 0,
          buttons,
          clientX: x,
          clientY: y,
        }),
      );
    const x0 = b.left + b.width * 0.3;
    const y0 = b.top + b.height * fy;
    send("pointerdown", x0, y0, 1);
    for (let i = 1; i <= 12; i++) {
      send("pointermove", x0 + i * 15, y0 + (i % 2) * 6, 1);
      await sleep(16);
      onMove?.();
    }
    send("pointerup", x0 + 180, y0, 0);
    await sleep(200);
  };
  const penBar = () =>
    root.querySelector<HTMLElement>('[role="toolbar"][aria-label="Pens"]');

  await step("pens-config-applies", async () => {
    await invoke("update_config", {
      changes: [
        { key: "pens.presets", value: SMOKE_PRESETS },
        { key: "laser.color", value: LASER_COLOR },
        { key: "laser.size", value: 6 },
      ],
    });
    await waitFor(
      "pen and laser preferences from config",
      () => {
        const p = getPreferences(win);
        return p.penPresets.length === 2 &&
          p.penPresets[1].name === "Smoke highlighter" &&
          p.laserColor === LASER_COLOR &&
          p.laserSize === 6
          ? true
          : null;
      },
      5000,
    );
    const problems = getSettingsStatus().problems;
    if (problems.length) {
      throw new Error(`Valid pens config raised ${JSON.stringify(problems)}`);
    }
    root
      .querySelector<HTMLButtonElement>(
        '.vault-editor [data-testid="toolbar-freedraw"]',
      )
      ?.click();
    const names = await waitFor(
      "pen bar with the configured pens",
      () => {
        const chips = Array.from(
          penBar()?.querySelectorAll<HTMLButtonElement>(
            "button:not(.pen-bar__settings)",
          ) ?? [],
        ).map((b) => b.getAttribute("aria-label"));
        return chips.join("|") === "Smoke ink|Smoke highlighter" ? chips : null;
      },
      5000,
    );
    // Laser: the trail is drawn in the configured colour.
    key("k");
    await sleep(150);
    let fill: string | null = null;
    await stroke(0.25, () => {
      fill ??=
        root
          .querySelector(".vault-editor .SVGLayer path")
          ?.getAttribute("fill") ?? null;
    });
    if (fill !== LASER_COLOR) {
      throw new Error(`Laser trail fill ${fill}, expected ${LASER_COLOR}`);
    }
    return { pens: names, laserFill: fill };
  });

  await step("pens-highlighter-draws-below-shapes", async () => {
    const before = await readLive();
    const rectIndex = before.findIndex((e) => e.type === "rectangle");
    if (rectIndex < 0) {
      throw new Error("Expected the earlier rectangle in the drawing");
    }
    root
      .querySelector<HTMLButtonElement>(
        '.vault-editor [data-testid="toolbar-freedraw"]',
      )
      ?.click();
    const chip = await waitFor("highlighter chip", () =>
      penBar()?.querySelector<HTMLButtonElement>(
        '[aria-label="Smoke highlighter"]',
      ),
    );
    chip.click();
    await sleep(100);
    await stroke(0.4);
    const isMine = (e: SceneEl) =>
      e.type === "freedraw" && !before.some((b) => b.id === e.id);
    const live = await saveUntil("highlighter stroke", (els) =>
      els.some(isMine),
    );
    const index = live.findIndex(isMine);
    const mine = live[index];
    const rectAfter = live.findIndex((e) => e.type === "rectangle");
    if (mine.strokeColor !== "#fab005" || mine.opacity !== 40) {
      throw new Error(
        `Highlighter stroke ${mine.strokeColor}/${mine.opacity}, expected #fab005/40`,
      );
    }
    if (index > rectAfter) {
      throw new Error(
        `Highlighter at z-index ${index}, above the rectangle at ${rectAfter}`,
      );
    }
    // Leave the drawing as it was for the later steps.
    key("Escape");
    key("z", true);
    await saveUntil("highlighter undone", (els) => !els.some(isMine));
    key("v");
    return { index, rectangleIndex: rectAfter, color: mine.strokeColor };
  });

  await invoke("update_config", {
    changes: CONFIG_KEYS.map((k) => ({ key: k, value: null })),
  });
  await waitFor(
    "default pens restored",
    () => (getPreferences(win).penPresets.length > 2 ? true : null),
    5000,
  );
}
