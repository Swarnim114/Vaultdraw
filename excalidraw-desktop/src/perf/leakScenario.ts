/**
 * Opt-in memory leak scenario (leak mode). After the default phases: open 50
 * different drawings, switch to a second vault and back, wait for idle, and
 * emit a `leak:<label>` mark at each checkpoint. The runner samples
 * per-process footprint on every such mark (perf/lib/leak.mjs summarises).
 *
 * The app has no "close drawing" action; the open drawing closes when the
 * vault is switched, so `after-vault-switch` is the closed state.
 */
import { expandFolder } from "./perfKit";

import type { PerfKit } from "./perfKit";

/** Root drawing of the second vault (perf/lib/extraVaults.mjs, ALT_MARKER). */
export const ALT_MARKER = "perf-alt-marker.excalidraw";
const DRAWINGS = 50;
const CHECKPOINT_EVERY = 10;
const BASELINE_SETTLE_MS = 8000;
const PASSES = 2;
/** Positions (in the 50-drawing sequence) of the root targets and image-heavy drawings. */
const SPECIAL_SLOTS = [2, 8, 14, 21, 30, 40];

/** The first `count - specials.length` children of the big folder, with the specials spread among them. */
export function planLeakDrawings(
  children: string[],
  specials: string[],
  count = DRAWINGS,
): string[] {
  const slots = SPECIAL_SLOTS.slice(0, specials.length);
  const pool = children.filter((path) => !specials.includes(path));
  const plan: string[] = [];
  for (let i = 0; i < count; i++) {
    const slot = slots.indexOf(i);
    const next = slot >= 0 ? specials[slot] : pool.shift();
    if (next === undefined) {
      break;
    }
    plan.push(next);
  }
  return plan;
}

export async function runLeakScenario(kit: PerfKit): Promise<void> {
  const { config, mark, sleep, row, treeRows, openByRow, waitUntil, info } =
    kit;
  const { bigFolder, openTargets, imageHeavy } = config;

  /** Settle, mark (the runner samples), and give the sampler time before the next step. */
  const checkpoint = async (label: string) => {
    await sleep(1000);
    await mark(`leak:${label}`);
    await sleep(1500);
  };

  const heavyDirs = [
    ...new Set(imageHeavy.map((h) => h.path.split("/").slice(0, -1).join("/"))),
  ];
  for (const dir of [bigFolder.path, ...heavyDirs]) {
    await expandFolder(kit, dir);
  }
  const children = kit
    .childRows(bigFolder.path)
    .map((el) => el.dataset.treePath ?? "")
    .filter((path) => path.endsWith(".excalidraw"))
    .sort();
  const specials = [
    openTargets.small,
    openTargets.medium,
    imageHeavy[0].path,
    openTargets.large,
    ...imageHeavy.slice(1).map((h) => h.path),
  ];
  const plan = planLeakDrawings(children, specials);
  info["leak.drawings"] = plan.length;

  // The previous phases leave the large drawing's decoded images behind, and WebKit hands that
  // memory back over several seconds: settle on a small drawing before the baseline, or the loop
  // would be measured against a transient.
  await openByRow(openTargets.small);
  await sleep(BASELINE_SETTLE_MS);
  await checkpoint("baseline");
  // Two passes over the same drawings: a plateau in pass 2 means caches, steady growth means a leak.
  for (let pass = 1; pass <= PASSES; pass++) {
    for (let i = 0; i < plan.length; i++) {
      await openByRow(plan[i]);
      await sleep(150);
      if ((i + 1) % CHECKPOINT_EVERY === 0 || i + 1 === plan.length) {
        await checkpoint(`p${pass}-after-${i + 1}`);
      }
    }
  }

  // Vault switch away and back. Needs the runner's second vault and a switch-capable
  // choose_vault; otherwise the click is a no-op and the series says so.
  const switchButton = () =>
    kit.root.querySelector<HTMLElement>(".vault-navigator__vault");
  const switchedAway = async () => {
    kit.click(switchButton(), "vault switcher");
    try {
      await waitUntil("second vault", () => Boolean(row(ALT_MARKER)), 8000);
      return true;
    } catch {
      return false;
    }
  };
  const away = await switchedAway();
  info["leak.vaultSwitch"] = away
    ? "switched"
    : "unavailable: choose_vault returned the same vault (no alternate vault hook)";
  await checkpoint("after-vault-switch");
  if (away) {
    kit.click(switchButton(), "vault switcher");
    await waitUntil(
      "first vault again",
      () => Boolean(row(openTargets.large)) && !row(ALT_MARKER),
      60_000,
    );
    await kit.afterPaint();
    info["leak.rowsAfterReturn"] = treeRows().length;
    await checkpoint("after-vault-return");
  }
  await sleep(5000);
  await checkpoint("idle-after");
}
