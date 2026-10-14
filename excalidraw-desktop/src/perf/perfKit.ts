/**
 * Toolkit the opt-in scenarios (leak, typical vault) share with the default
 * scenarios in perfScenarios.ts: DOM helpers, open/save/pan primitives and the
 * run-wide sample/info/error sinks. No environment-specific imports.
 */
import type fixturesConfig from "../../perf/fixtures.config.json";

export type PerfConfig = typeof fixturesConfig;

/** Opt-in run modes; the default gate run has none set. */
/** leakOnly: leak scenario straight after vault-open (clean baseline), without the stress phases. */
export type PerfModes = {
  leak?: boolean;
  leakOnly?: boolean;
  typical?: boolean;
};

export type PerfKit = {
  root: HTMLElement;
  doc: Document;
  win: Window & typeof globalThis;
  config: PerfConfig;
  modes: PerfModes;
  samples: Record<string, number[]>;
  info: Record<string, unknown>;
  errors: string[];
  mark: (name: string) => Promise<void>;
  log: (msg: string) => void;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  raf: () => Promise<void>;
  afterPaint: () => Promise<void>;
  waitUntil: (label: string, cond: () => boolean, ms?: number) => Promise<void>;
  push: (id: string, value: number) => void;
  row: (path: string) => HTMLElement | null;
  treeRows: () => HTMLElement[];
  childRows: (folder: string) => HTMLElement[];
  click: (el: HTMLElement | null, label: string) => void;
  key: (target: EventTarget, k: string, extra?: KeyboardEventInit) => void;
  interactiveCanvas: () => HTMLCanvasElement | null;
  editorId: () => string | null;
  openByRow: (path: string) => Promise<number>;
  ensureOpen: (path: string) => Promise<void>;
  saveOnce: (path: string, metric: string) => Promise<void>;
  wheelPass: (
    canvas: HTMLCanvasElement,
    totalMs: number,
    makeEvent: (phase: 0 | 1) => WheelEventInit,
  ) => Promise<{ intervals: number[]; verified: boolean }>;
  scenario: (name: string, work: () => Promise<void>) => Promise<void>;
  wrapWrites: () => void;
  resetWrites: () => void;
};

/** Click "Open Vault Folder" on the onboarding screen; resolves once `ready()` holds. Returns elapsed ms. */
export async function openVaultFolder(
  kit: PerfKit,
  ready: () => boolean,
): Promise<number> {
  const { root, now, waitUntil, afterPaint } = kit;
  if (!root.querySelector(".vault-onboarding")) {
    throw new Error("Onboarding is not visible");
  }
  const button = Array.from(root.querySelectorAll("button")).find(
    (item) => item.textContent?.trim() === "Open Vault Folder",
  );
  if (!button) {
    throw new Error('"Open Vault Folder" button not found');
  }
  const t0 = now();
  button.click();
  await waitUntil("root tree rows", ready, 60_000);
  await afterPaint();
  return now() - t0;
}

/** Expand every ancestor folder of `folderPath` and the folder itself, waiting for its children. */
export async function expandFolder(
  kit: PerfKit,
  folderPath: string,
): Promise<void> {
  const { row, click, waitUntil, childRows, afterPaint } = kit;
  const parts = folderPath.split("/");
  for (let i = 1; i <= parts.length; i++) {
    const current = parts.slice(0, i).join("/");
    await waitUntil(`row ${current}`, () => Boolean(row(current)));
    if (row(current)?.getAttribute("aria-expanded") !== "true") {
      click(row(current), current);
    }
    await waitUntil(
      `children of ${current}`,
      () => childRows(current).length > 0,
    );
  }
  await afterPaint();
}
