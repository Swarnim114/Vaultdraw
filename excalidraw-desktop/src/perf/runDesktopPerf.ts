import { invoke } from "@tauri-apps/api/core";

import fixturesConfig from "../../perf/fixtures.config.json";
import { desktopRepository } from "../vault/DesktopVaultRepository";

import { installIpcTrace } from "./ipcTrace";
import { runPerfScenarios } from "./perfScenarios";

import type { NativeProbe, RefreshRateInput } from "./refreshRate";

const IDLE_MS = 10_000;

/** Native side of the refresh-rate probe (smoke-test build commands). */
const nativeProbe: NativeProbe = {
  displayInfo: () =>
    invoke<Record<string, unknown>>("perf_display_info", { sampleMs: 500 }),
  input: (args) => invoke<Record<string, unknown>>("perf_native_input", args),
};

const REFRESH_RATE_INPUTS: RefreshRateInput[] = [
  "idle",
  "zoom.native",
  "zoom.gesture",
  "zoom.wheel",
  "pan.native",
  "pan.wheel",
];

/** Refresh-rate drawings: all of them for the standalone suite, the harness subset otherwise. */
const refreshRateOptions = (only: boolean) => {
  const spec = fixturesConfig.refreshRate;
  const patterns = only ? spec.patterns : spec.harness.patterns;
  const sizes = only ? spec.elements : [spec.harness.elements];
  return {
    native: nativeProbe,
    only,
    inputs: only
      ? REFRESH_RATE_INPUTS
      : (["zoom.native", "zoom.gesture", "pan.native"] as RefreshRateInput[]),
    drawings: patterns.flatMap((pattern) =>
      sizes.map((elements) => ({
        path: `hz-${pattern}-${elements}.excalidraw`,
        pattern,
        elements,
      })),
    ),
  };
};

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

    // Heartbeat: tells a stalled run apart (hidden/occluded WebView stops rAF, JS hang, IPC hang).
    // Stall diagnostics stop before the idle window. No rAF loop here: one would keep the WebView
    // rendering every frame and perturb the measurements (the scenarios' rAF watchdog reports stalls).
    const heartbeat = win.setInterval(() => {
      void invoke("smoke_log", {
        step: "perf-mark",
        ok: true,
        details: {
          name: "heartbeat",
          wallMs: Date.now(),
          perfMs: win.performance.now(),
          visibility: doc.visibilityState,
          hasFocus: doc.hasFocus(),
        },
      }).catch(() => undefined);
    }, 5000);
    const trace = installIpcTrace(desktopRepository, win, (name, details) => {
      void invoke("smoke_log", {
        step: "perf-mark",
        ok: true,
        details: {
          name,
          wallMs: Date.now(),
          perfMs: win.performance.now(),
          ...details,
        },
      }).catch(() => undefined);
    });
    const environment = await invoke<{ perfSuite?: string }>(
      "smoke_environment",
    ).catch(() => ({ perfSuite: "" }));
    const onlyRefreshRate = environment.perfSuite === "refresh-rate";
    const { samples, info, errors } = await runPerfScenarios({
      root,
      doc,
      win,
      repository: desktopRepository,
      config: fixturesConfig,
      mark,
      refreshRate: refreshRateOptions(onlyRefreshRate),
      // Progress lines (smoke-progress.log) for the standalone suite only: the
      // full run keeps the vault folder free of extra writes.
      log: onlyRefreshRate
        ? (message) => {
            void invoke("smoke_log", { step: `~${message}`, ok: true }).catch(
              () => undefined,
            );
          }
        : undefined,
    });

    if (onlyRefreshRate) {
      // Standalone refresh-rate suite: no idle / memory phase.
      trace.uninstall();
      win.clearInterval(heartbeat);
      await invoke("smoke_finish", {
        status: errors.length ? 1 : 0,
        details: { perf: { version: 1, env: "tauri", samples, info, errors } },
      });
      return;
    }

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

    Object.assign(info, trace.finish());
    trace.uninstall();
    win.clearInterval(heartbeat);
    await mark("idle-begin");
    await sleep(IDLE_MS);
    await mark("idle-end");
    // Keep the process alive while the runner reads footprint / cpu for the idle-end sample.
    await sleep(2000);

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
