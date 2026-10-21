import { useEffect, useRef } from "react";

import { registerCommandHandlers } from "../commands/handlerRegistry";
import { getPreferences, subscribePreferences } from "../vault/preferences";
import { toastStore } from "../toasts/toastStore";

import { createControlBridge, type ControlDeps } from "./bridge";
import { commandInfos, createSnapshotSender } from "./commandsSnapshot";

type Invoke = ControlDeps["invoke"];

const SNAPSHOT_DEBOUNCE_MS = 1000;

export const CLI_INSTALL_ID = "cli.install";
export const CLI_INSTALL_SYSTEM_ID = "cli.installSystem";

const inTauri = (win: Window) => "__TAURI_INTERNALS__" in win;

/** Palette handlers: install the `vaultdraw` command (user PATH or /usr/local/bin). */
const installCli = (system: boolean) => async () => {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const { path } = (await invoke("control_install_cli", { system })) as {
      path: string;
    };
    toastStore.push({ message: `Installed 'vaultdraw' command at ${path}` });
  } catch (e) {
    toastStore.push({
      message: e instanceof Error ? e.message : String(e),
      kind: "error",
    });
  }
};

/**
 * Connects the window to the Rust control server: one event listener, no
 * polling, a debounced command-list snapshot after startup is idle. A no-op
 * outside Tauri (browser e2e harness).
 */
export function useControlBridge(
  win: Window | null,
  deps: Pick<ControlDeps, "runner" | "appState" | "openTarget">,
): void {
  const live = useRef(deps);
  live.current = deps;

  useEffect(
    () =>
      registerCommandHandlers({
        [CLI_INSTALL_ID]: installCli(false),
        [CLI_INSTALL_SYSTEM_ID]: installCli(true),
      }),
    [],
  );

  useEffect(() => {
    if (!win || !inTauri(win)) {
      return;
    }
    let disposed = false;
    let stop: (() => void) | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let unsubscribe: (() => void) | null = null;

    void (async () => {
      try {
        const [{ invoke }, { listen }] = await Promise.all([
          import("@tauri-apps/api/core"),
          import("@tauri-apps/api/event"),
        ]);
        if (disposed) {
          return;
        }
        const call = invoke as Invoke;
        const overrides = () => getPreferences(win).hotkeys;
        const bridge = createControlBridge({
          listen: listen as unknown as ControlDeps["listen"],
          invoke: call,
          overrides,
          runner: () => live.current.runner(),
          appState: () => live.current.appState(),
          openTarget: (t, c) => live.current.openTarget(t, c),
        });
        const send = createSnapshotSender((commands) =>
          call("control_commands_snapshot", {
            commands,
          }),
        );
        const push = () =>
          void send(commandInfos(overrides(), live.current.runner().platform));
        const schedule = () => {
          clearTimeout(timer);
          timer = setTimeout(push, SNAPSHOT_DEBOUNCE_MS);
        };
        const unlisten = await bridge.start();
        if (disposed) {
          unlisten();
          return;
        }
        stop = unlisten;
        unsubscribe = subscribePreferences(schedule);
        const idle = (
          win as Window & {
            requestIdleCallback?: (cb: () => void) => number;
          }
        ).requestIdleCallback;
        if (idle) {
          idle.call(win, push);
        } else {
          schedule();
        }
      } catch {
        // Control server not available: the bridge stays off.
      }
    })();

    return () => {
      disposed = true;
      clearTimeout(timer);
      unsubscribe?.();
      stop?.();
    };
  }, [win]);
}
