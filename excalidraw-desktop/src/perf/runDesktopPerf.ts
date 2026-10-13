import { invoke } from "@tauri-apps/api/core";

import fixturesConfig from "../../perf/fixtures.config.json";
import { desktopRepository } from "../vault/DesktopVaultRepository";

import { runPerfScenarios } from "./perfScenarios";

const IDLE_MS = 10_000;

/** Packaged-app perf run (VITE_APP_PERF_TEST=true). Reports through the smoke bridge. */
export async function runDesktopPerf(): Promise<void> {
  const win = window;
  const doc = win.document;
  const sleep = (ms: number) =>
    new Promise<void>((resolve) => win.setTimeout(resolve, ms));
  const mark = (name: string) =>
    invoke<void>("smoke_log", {
      step: "perf-mark",
      ok: true,
      details: { name, wallMs: Date.now(), perfMs: win.performance.now() },
    });

  const markPids = async () => {
    try {
      const pids = await invoke<unknown>("perf_process_ids");
      await invoke("smoke_log", {
        step: "perf-mark",
        ok: true,
        details: {
          name: "pids",
          wallMs: Date.now(),
          perfMs: win.performance.now(),
          pids,
        },
      });
    } catch (error) {
      await invoke("smoke_log", {
        step: "perf-mark",
        ok: false,
        details: { name: "pids", error: String(error) },
      });
    }
  };

  let root: HTMLElement | null = null;
  for (let i = 0; i < 200 && !root; i++) {
    root = doc.querySelector<HTMLElement>(".vault-app");
    if (!root) {
      await sleep(50);
    }
  }
  if (!root) {
    await invoke("smoke_finish", {
      status: 1,
      details: { startupFailure: "Timed out waiting for .vault-app mount" },
    });
    return;
  }

  // Keep the recent-vault preference write out of the user's real storage (same isolation as the smoke run).
  const preferencesKey = "excalidraw-vault-preferences-v1";
  try {
    const proto = Object.getPrototypeOf(win.localStorage) as Storage;
    const descriptor = Object.getOwnPropertyDescriptor(proto, "setItem");
    if (descriptor?.value && descriptor.configurable) {
      const original = descriptor.value as Storage["setItem"];
      Object.defineProperty(proto, "setItem", {
        ...descriptor,
        value(this: Storage, key: string, value: string) {
          if (key !== preferencesKey) {
            return original.call(this, key, value);
          }
        },
      });
    }
  } catch {
    // Best effort; the perf run does not depend on it.
  }

  try {
    while (!root.querySelector(".vault-onboarding")) {
      await sleep(20);
    }
    await mark("interactive");
    await markPids();

    const { samples, info, errors } = await runPerfScenarios({
      root,
      doc,
      win,
      repository: desktopRepository,
      config: fixturesConfig,
      mark,
    });

    // Idle must be truly idle: wait until autosave has settled (no write started for 1.5 s).
    let lastWriteAt = win.performance.now();
    let inFlight = 0;
    const originalWrite = desktopRepository.writeDrawing;
    desktopRepository.writeDrawing = async (input) => {
      inFlight += 1;
      lastWriteAt = win.performance.now();
      try {
        return await originalWrite(input);
      } finally {
        inFlight -= 1;
        lastWriteAt = win.performance.now();
      }
    };
    const settleUntil = win.performance.now() + 30_000;
    while (
      (inFlight > 0 || win.performance.now() - lastWriteAt < 1500) &&
      win.performance.now() < settleUntil
    ) {
      await sleep(100);
    }
    desktopRepository.writeDrawing = originalWrite;
    await markPids();

    await mark("idle-begin");
    await sleep(IDLE_MS);
    await mark("idle-end");

    await invoke("smoke_finish", {
      status: errors.length ? 1 : 0,
      details: {
        perf: { version: 1, env: "tauri", samples, info, errors },
      },
    });
  } catch (error) {
    await invoke("smoke_finish", {
      status: 1,
      details: { startupFailure: String(error) },
    });
  }
}
