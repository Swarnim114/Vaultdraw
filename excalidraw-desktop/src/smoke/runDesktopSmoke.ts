import { desktopRepository } from "../vault/DesktopVaultRepository";
import { DEFAULT_PREFERENCES, getPreferences } from "../vault/preferences";
import {
  getSettingsStatus,
  PREFERENCES_CHANGED_EVENT,
  SETTINGS_STATUS_EVENT,
} from "../vault/settingsSync";

import type {
  ConfigChange,
  LoadSettingsResult,
  SettingsStatus,
} from "../vault/settingsSync";
import type { VaultPreferences } from "../vault/preferences";

import type { VaultEntry, VaultInfo } from "../vault/types";

type SmokeRecord = { step: string; ok: boolean; details?: unknown };
type SmokeEnvironment = {
  enabled: boolean;
  vaultPath: string;
  exportPath: string;
};

type Native = {
  choose_vault: (args: { create: boolean }) => Promise<VaultInfo | null>;
  reopen_vault: () => Promise<VaultInfo | null>;
  create_folder: (args: { handle: string; path: string }) => Promise<void>;
  list_directory: (args: {
    handle: string;
    path: string;
  }) => Promise<VaultEntry[]>;
  write_drawing: (args: {
    handle: string;
    path: string;
    json: string;
    expectedRevision: string | null;
    operationId: string;
  }) => Promise<{ revision: string }>;
  read_drawing: (args: {
    handle: string;
    path: string;
  }) => Promise<{ json: string; revision: string }>;
  export_file: (args: { name: string; bytes: number[] }) => Promise<boolean>;
  load_settings: () => Promise<LoadSettingsResult>;
  update_config: (args: { changes: ConfigChange[] }) => Promise<void>;
  smoke_environment: () => Promise<SmokeEnvironment>;
  smoke_log: (args: {
    step: string;
    ok: boolean;
    details?: unknown;
  }) => Promise<void>;
  smoke_finish: (args: { status: number; details?: unknown }) => Promise<void>;
};

const timeout = 12_000;

/** config.toml defaults from personal/planning/config.md, as load_settings JSON. */
const DEFAULT_CONFIG_JSON = {
  appearance: {
    theme: "Default",
    mode: "system",
    sync_canvas: false,
    canvas_background: "#ffffff",
  },
  editor: {
    font_family: 5,
    font_size: 20,
    stroke_color: "#1e1e1e",
    background_color: "transparent",
    fill_style: "solid",
    stroke_width: 2,
    roughness: 1,
  },
  saving: { autosave_delay_ms: 500 },
};

/** Recursive key-order-insensitive comparison; returns mismatching paths. */
const diffJson = (expected: unknown, actual: unknown, path = ""): string[] => {
  if (
    expected &&
    typeof expected === "object" &&
    actual &&
    typeof actual === "object"
  ) {
    const e = expected as Record<string, unknown>;
    const a = actual as Record<string, unknown>;
    const keys = new Set([...Object.keys(e), ...Object.keys(a)]);
    return Array.from(keys).flatMap((key) =>
      diffJson(e[key], a[key], path ? `${path}.${key}` : key),
    );
  }
  return expected === actual
    ? []
    : [
        `${path}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(
          actual,
        )}`,
      ];
};

const withConfig = (
  patch: Record<string, Record<string, unknown>>,
): typeof DEFAULT_CONFIG_JSON => {
  const next = JSON.parse(JSON.stringify(DEFAULT_CONFIG_JSON));
  for (const [table, values] of Object.entries(patch)) {
    Object.assign(next[table], values);
  }
  return next;
};
const delay = (win: Window, ms: number) =>
  new Promise<void>((resolve) => win.setTimeout(resolve, ms));

/** Run in the packaged Tauri WebView after VaultApp mounts. No WebDriver/Accessibility required. */
export async function runDesktopSmoke(): Promise<void> {
  // Initial mount lookup may use globals; everything after derives from ownerDocument/defaultView.
  const bootDoc = typeof document !== "undefined" ? document : null;
  const bootWin =
    bootDoc?.defaultView ?? (typeof window !== "undefined" ? window : null);
  const bootDelay = (ms: number) =>
    new Promise<void>((resolve) => {
      if (bootWin) {
        bootWin.setTimeout(resolve, ms);
      } else {
        setTimeout(resolve, ms);
      }
    });
  // Bounded wait for the mount so a missing/slow root reports to native instead of throwing pre-log.
  let root: HTMLElement | null = null;
  const rootUntil = Date.now() + 10_000;
  while (!root && Date.now() < rootUntil) {
    root = bootDoc?.querySelector<HTMLElement>(".vault-app") ?? null;
    if (!root) {
      await bootDelay(100);
    }
  }
  if (!root) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("smoke_finish", {
        status: 1,
        details: { startupFailure: "Timed out waiting for .vault-app mount" },
      });
    } catch (finishError) {
      console.error(
        "Desktop smoke could not report missing mount",
        finishError,
      );
    }
    return;
  }
  const doc = root.ownerDocument;
  const win = doc.defaultView;
  if (!win) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("smoke_finish", {
        status: 1,
        details: { startupFailure: "Mounted app has no owner window" },
      });
    } catch (finishError) {
      console.error(
        "Desktop smoke could not report missing owner window",
        finishError,
      );
    }
    return;
  }
  const startedAt = win.performance.now();
  const records: SmokeRecord[] = [];
  const pageErrors: Array<{ type: string; message: string }> = [];
  // VaultApp stores recent paths in localStorage; suppress that preference write for this run.
  const preferencesKey = "excalidraw-vault-preferences-v1";
  let preferenceWritesSuppressed = false;
  let restoreStorage = () => {};
  try {
    const storage = win.localStorage;
    const storagePrototype = Object.getPrototypeOf(storage) as Storage;
    const storageSetDescriptor = Object.getOwnPropertyDescriptor(
      storagePrototype,
      "setItem",
    );
    if (!storageSetDescriptor?.value || !storageSetDescriptor.configurable) {
      throw new Error("Storage.setItem cannot be isolated");
    }
    const originalSetItem = storageSetDescriptor.value as Storage["setItem"];
    Object.defineProperty(storagePrototype, "setItem", {
      ...storageSetDescriptor,
      value(this: Storage, key: string, value: string) {
        if (key !== preferencesKey) {
          return originalSetItem.call(this, key, value);
        }
      },
    });
    restoreStorage = () =>
      Object.defineProperty(storagePrototype, "setItem", storageSetDescriptor);
    preferenceWritesSuppressed = true;
  } catch (error) {
    pageErrors.push({ type: "preference-isolation", message: String(error) });
  }
  const onError = (event: ErrorEvent) =>
    pageErrors.push({ type: "error", message: event.message });
  const onRejection = (event: PromiseRejectionEvent) =>
    pageErrors.push({
      type: "unhandledrejection",
      message: String(event.reason),
    });
  // Upstream Excalidraw's SVG export sets style="white-space: pre;" on text
  // nodes (renderer), which the packaged CSP reports as style-src-attr. The
  // attribute still serializes into the file, so it is tracked separately
  // and only while the smoke run's SVG export is in flight.
  const knownCspReports: unknown[] = [];
  let svgExportInFlight = false;
  const onCsp = (event: SecurityPolicyViolationEvent) =>
    (svgExportInFlight && event.violatedDirective === "style-src-attr"
      ? knownCspReports
      : pageErrors
    ).push({
      type: "csp",
      message: `${event.violatedDirective}: ${event.blockedURI}`,
      // Where/when: helps tell product CSP problems from harness ones.
      afterStep: records[records.length - 1]?.step ?? "(none)",
      source: `${event.sourceFile}:${event.lineNumber}`,
      sample: event.sample,
      disposition: event.disposition,
    } as { type: string; message: string });
  win.addEventListener("error", onError);
  win.addEventListener("unhandledrejection", onRejection);
  doc.addEventListener("securitypolicyviolation", onCsp);

  const { invoke } = await import("@tauri-apps/api/core");
  const call = <K extends keyof Native>(
    command: K,
    args?: Record<string, unknown>,
  ) => invoke(command, args) as ReturnType<Native[K]>;

  const waitFor = async <T>(
    label: string,
    read: () => T | null | undefined,
    ms = timeout,
  ): Promise<T> => {
    const until = win.performance.now() + ms;
    while (win.performance.now() < until) {
      const result = read();
      if (result != null) {
        return result;
      }
      await delay(win, 50);
    }
    throw new Error(`Timed out after ${ms}ms waiting for ${label}`);
  };
  const step = async <T>(name: string, work: () => Promise<T>): Promise<T> => {
    try {
      const details = await work();
      records.push({ step: name, ok: true, details });
      return details;
    } catch (error) {
      records.push({ step: name, ok: false, details: String(error) });
      throw error;
    }
  };
  const button = (name: string) => {
    const found = Array.from(root.querySelectorAll("button")).find(
      (item) =>
        item.getAttribute("aria-label") === name ||
        item.title === name ||
        item.textContent?.trim() === name,
    );
    if (!found) {
      throw new Error(`UI button not found: ${name}`);
    }
    return found;
  };
  const clickSubmit = async (dialog: Element, name: string) => {
    const input = dialog.querySelector<HTMLInputElement>("#create-entry-name");
    const submit = Array.from(
      dialog.querySelectorAll<HTMLButtonElement>("button"),
    ).find((item) => item.textContent?.trim() === "Create");
    if (!input || !submit) {
      throw new Error(
        "Create dialog did not expose expected name field and submit button",
      );
    }
    const setter = Object.getOwnPropertyDescriptor(
      win.HTMLInputElement.prototype,
      "value",
    )?.set;
    setter?.call(input, name);
    input.dispatchEvent(new win.Event("input", { bubbles: true }));
    input.dispatchEvent(new win.Event("change", { bubbles: true }));
    // Controlled React input enables submit asynchronously; wait a tick so .click() does not hit disabled submit.
    await delay(win, 0);
    await waitFor(
      "create submit enabled",
      () => (submit.disabled ? null : submit),
      5000,
    );
    submit.click();
  };

  let exitStatus = 1;
  let vaultForReport: VaultInfo | null = null;
  try {
    if (!preferenceWritesSuppressed) {
      throw new Error(
        "Smoke run cannot proceed without suppressing recent-vault preference writes",
      );
    }
    const env = await call("smoke_environment");
    if (!env.enabled || !env.vaultPath) {
      throw new Error("Native smoke environment is not enabled");
    }
    const vault = await step(
      "startup-and-onboarding",
      async (): Promise<VaultInfo> => {
        await waitFor("onboarding", () =>
          root.querySelector(".vault-onboarding"),
        );
        const elapsedMs = Math.round(win.performance.now() - startedAt);
        const originalChooseVault = desktopRepository.chooseVault;
        let chosenPromise: Promise<VaultInfo | null> | null = null;
        desktopRepository.chooseVault = async (create?: boolean) => {
          const promise = originalChooseVault.call(desktopRepository, create);
          chosenPromise = promise;
          return promise;
        };
        let chosen: VaultInfo | null = null;
        try {
          button("Open Vault Folder").click();
          vaultForReport = await waitFor("native test vault", () => {
            const path =
              root.querySelector<HTMLElement>("[data-vault-path]")?.dataset
                .vaultPath;
            return path === env.vaultPath
              ? { handle: "", path, name: "", readOnly: false }
              : null;
          });
          const interceptedPromise = await waitFor(
            "UI choose_vault IPC result",
            () => chosenPromise,
          );
          chosen = await interceptedPromise;
          if (!chosen || chosen.path !== env.vaultPath) {
            throw new Error(
              "UI choose_vault did not return configured test folder",
            );
          }
          vaultForReport = chosen;
        } finally {
          desktopRepository.chooseVault = originalChooseVault;
        }
        return Object.assign(chosen, {
          elapsedMs,
          method:
            "onboarding UI click intercepted at desktopRepository.chooseVault IPC",
        });
      },
    );
    vaultForReport = vault;
    const activeVault = vault;
    const runId = Math.floor(win.Date.now()).toString(36);
    const nested = `smoke-suite-${runId}/nested`;
    const filePath = `${nested}/ipc-fixture.excalidraw`;
    let watcherPromise: Promise<unknown> | undefined;
    let listenReady: Promise<void> | undefined;
    let stopListening: (() => void) | undefined;
    try {
      const { listen } = await import("@tauri-apps/api/event");
      watcherPromise = new Promise((resolve) => {
        listenReady = listen("vault-change", (event) => {
          const payload = event.payload as {
            handle?: string;
            paths?: string[];
          };
          if (
            payload.handle === activeVault.handle &&
            payload.paths?.some((path) => path.includes("watcher-own-write"))
          ) {
            resolve(payload);
          }
        }).then((off) => {
          stopListening = off;
        });
      });
    } catch {
      /* listener failure is reported by explicit watch step */
    }

    await step("native-crud-read-write-list", async () => {
      await call("create_folder", {
        handle: activeVault.handle,
        path: `smoke-suite-${runId}`,
      });
      await call("create_folder", { handle: activeVault.handle, path: nested });
      const source = JSON.stringify({
        type: "excalidraw",
        version: 2,
        source: "desktop-smoke",
        elements: [],
        appState: {},
        files: {},
      });
      await call("write_drawing", {
        handle: activeVault.handle,
        path: filePath,
        json: source,
        expectedRevision: null,
        operationId: "smoke-ipc-create",
      });
      const read = await call("read_drawing", {
        handle: activeVault.handle,
        path: filePath,
      });
      if (JSON.parse(read.json).type !== "excalidraw" || !read.revision) {
        throw new Error("IPC read returned invalid Excalidraw JSON/revision");
      }
      const entries = await call("list_directory", {
        handle: activeVault.handle,
        path: nested,
      });
      if (
        !entries.some(
          (entry) => entry.path === filePath && entry.kind === "drawing",
        )
      ) {
        throw new Error("IPC listing missed created drawing");
      }
      return {
        path: filePath,
        operations: "native IPC fixture provisioning + read/list assertions",
      };
    });
    await step("native-export-sandbox", async () => {
      const name = `smoke-export-${runId}.txt`;
      const bytes = Array.from("offline smoke export", (character) =>
        character.charCodeAt(0),
      );
      const exported = await call("export_file", { name, bytes });
      if (!exported) {
        throw new Error(
          "Smoke export was canceled instead of writing inside the sandbox",
        );
      }
      return {
        file: `${env.exportPath}/${name}`,
        noDialog: true,
        constrainedByNative: "smoke-exports subdirectory",
      };
    });
    await step("native-watcher-own-write", async () => {
      await listenReady;
      const path = `${nested}/watcher-own-write.excalidraw`;
      const json = JSON.stringify({
        type: "excalidraw",
        version: 2,
        elements: [],
        appState: {},
        files: {},
      });
      await call("write_drawing", {
        handle: activeVault.handle,
        path,
        json,
        expectedRevision: null,
        operationId: "smoke-watcher-own-write",
      });
      if (!watcherPromise) {
        throw new Error("Tauri event listener unavailable");
      }
      const event = await Promise.race([
        watcherPromise,
        delay(win, 5000).then(() => {
          throw new Error("No vault-change event for own write within 5s");
        }),
      ]);
      return {
        event,
        limitation:
          "asserts native write reaches subscribed WebView; app-level refresh remains UI worker behavior",
      };
    });
    stopListening?.();

    await step("ui-create-drawing-and-open-editor", async () => {
      const outer = await waitFor("suite folder tree row", () =>
        Array.from(
          root.querySelectorAll<HTMLElement>(".vault-tree-item__name"),
        ).find((item) => item.textContent?.trim() === `smoke-suite-${runId}`),
      );
      outer.closest<HTMLElement>(".vault-tree-item")?.click();
      const folder = await waitFor("nested folder tree row", () =>
        Array.from(
          root.querySelectorAll<HTMLElement>(".vault-tree-item__name"),
        ).find(
          (item) =>
            item.title === nested || item.textContent?.trim() === "nested",
        ),
      );
      folder.closest<HTMLElement>(".vault-tree-item")?.click();
      const createInFolder = await waitFor(
        "new drawing in folder action",
        () =>
          folder
            .closest<HTMLElement>(".vault-tree-item")
            ?.querySelector<HTMLButtonElement>(
              '[aria-label="New drawing in folder"]',
            ) ??
          root.querySelector<HTMLButtonElement>(
            '[aria-label="New drawing in folder"]',
          ),
      );
      createInFolder.click();
      const dialog = await waitFor("drawing create dialog", () =>
        root.querySelector('[role="dialog"]'),
      );
      await clickSubmit(dialog, "ui-edited.excalidraw");
      await waitFor("actual editor mount", () =>
        root.querySelector(".vault-editor [data-testid], .vault-editor canvas"),
      );
      await waitFor("active UI path", () =>
        root.querySelector<HTMLElement>(
          ".vault-tree-item--active .vault-tree-item__name",
        )?.title === `${nested}/ui-edited.excalidraw`
          ? true
          : null,
      );
      return {
        path: `${nested}/ui-edited.excalidraw`,
        method: "create through navigator UI; editor from mounted VaultEditor",
      };
    });

    // Informational: about 120 on ProMotion displays when WebKit's 60fps cap is
    // disabled (see webview_configuration in lib.rs), about 60 otherwise.
    await step("render-frame-rate", async () => {
      const frames = await new Promise<number>((resolve) => {
        let count = 0;
        let start = 0;
        const tick = (now: number) => {
          start ||= now;
          count += 1;
          if (now - start < 1000) {
            win.requestAnimationFrame(tick);
          } else {
            resolve(Math.round((count * 1000) / (now - start)));
          }
        };
        win.requestAnimationFrame(tick);
      });
      return { requestAnimationFramePerSecond: frames };
    });

    await step("canvas-pointer-draw", async () => {
      // Ensure editor and excalidraw container resolve flex height in WebKit
      const editorEl = root.querySelector<HTMLElement>(".vault-editor");
      if (editorEl && editorEl.offsetHeight === 0) {
        editorEl.style.flex = "1 1 auto";
        editorEl.style.minHeight = "0";
        editorEl.style.height = "100%";
      }
      const excalidrawEl = root.querySelector<HTMLElement>(
        ".vault-editor .excalidraw",
      );
      if (excalidrawEl && excalidrawEl.offsetHeight === 0) {
        excalidrawEl.style.flex = "1 1 auto";
        excalidrawEl.style.minHeight = "0";
        excalidrawEl.style.height = "100%";
      }
      const canvas = await waitFor(
        "usable Excalidraw canvas",
        () => {
          const el =
            root.querySelector<HTMLCanvasElement>(
              ".vault-editor canvas.interactive",
            ) ??
            root.querySelector<HTMLCanvasElement>(
              ".vault-editor .interactive-canvas",
            ) ??
            root.querySelector<HTMLCanvasElement>(".vault-editor canvas");
          if (!el) {
            return null;
          }
          const b = el.getBoundingClientRect();
          return b.width >= 40 && b.height >= 40 ? el : null;
        },
        5000,
      );
      const bounds = canvas.getBoundingClientRect();
      const canvasInfo = {
        width: bounds.width,
        height: bounds.height,
        hasPointerEvent: Boolean(win.PointerEvent),
        offsetWidth: canvas.offsetWidth,
        offsetHeight: canvas.offsetHeight,
      };
      if (!win.PointerEvent) {
        throw new Error(
          `PointerEvent unavailable in WebView: ${JSON.stringify(canvasInfo)}`,
        );
      }
      if (bounds.width < 40 || bounds.height < 40) {
        throw new Error(
          `Canvas does not expose a usable pointer target in this WebView: ${JSON.stringify(
            canvasInfo,
          )}`,
        );
      }
      // Prefer the real toolbar control, then use the rectangle shortcut if this version labels it differently.
      const rectangleTool =
        root.querySelector<HTMLButtonElement>(
          '[data-testid="toolbar-rectangle"]',
        ) ??
        Array.from(root.querySelectorAll<HTMLButtonElement>("button")).find(
          (item) =>
            /rectangle/i.test(
              `${item.getAttribute("aria-label") ?? ""} ${item.title} ${
                item.getAttribute("data-testid") ?? ""
              }`,
            ),
        );
      if (rectangleTool) {
        rectangleTool.click();
      } else {
        doc.dispatchEvent(
          new win.KeyboardEvent("keydown", { key: "r", bubbles: true }),
        );
      }
      await delay(win, 150);
      const x1 = bounds.left + Math.max(40, bounds.width * 0.35);
      const y1 = bounds.top + Math.max(40, bounds.height * 0.35);
      const x2 = x1 + 90;
      const y2 = y1 + 70;
      const send = (type: string, x: number, y: number, buttons: number) =>
        canvas.dispatchEvent(
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
      send("pointerdown", x1, y1, 1);
      send("pointermove", (x1 + x2) / 2, (y1 + y2) / 2, 1);
      send("pointermove", x2, y2, 1);
      send("pointerup", x2, y2, 0);
      await delay(win, 300);
      return {
        target: "rendered Excalidraw canvas",
        gesture: "rectangle toolbar/shortcut + pointerdown/move/up",
        caveat:
          "synthetic WebView events do not prove physical-device input parity",
      };
    });

    await step("save-and-native-source-assertion", async () => {
      doc.dispatchEvent(
        new win.KeyboardEvent("keydown", {
          key: "s",
          metaKey: true,
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
      // SaveCoordinator debounce is 600ms; allow editor serialization plus IPC commit and watcher settle.
      await delay(win, 2200);
      let read = await call("read_drawing", {
        handle: activeVault.handle,
        path: `${nested}/ui-edited.excalidraw`,
      });
      let parsed = JSON.parse(read.json) as {
        type?: unknown;
        version?: unknown;
        elements?: Array<{ isDeleted?: boolean; type?: string }>;
        appState?: unknown;
        files?: unknown;
      };
      let live = (parsed.elements ?? []).filter(
        (element) => !element.isDeleted,
      );
      if (!live.some((element) => element.type === "rectangle")) {
        // One bounded retry after brief delay in case dirty check or debounce was in flight
        await delay(win, 1500);
        read = await call("read_drawing", {
          handle: activeVault.handle,
          path: `${nested}/ui-edited.excalidraw`,
        });
        parsed = JSON.parse(read.json) as {
          type?: unknown;
          version?: unknown;
          elements?: Array<{ isDeleted?: boolean; type?: string }>;
          appState?: unknown;
          files?: unknown;
        };
        live = (parsed.elements ?? []).filter((element) => !element.isDeleted);
      }
      if (
        parsed.type !== "excalidraw" ||
        !Number.isFinite(parsed.version) ||
        !Array.isArray(parsed.elements) ||
        !parsed.appState ||
        !parsed.files
      ) {
        throw new Error(
          "Saved source is not a structurally valid Excalidraw scene",
        );
      }
      if (
        !live.length ||
        !live.some((element) => element.type === "rectangle")
      ) {
        throw new Error(
          "Saved source has no nondeleted rectangle; pointer drawing was not proven",
        );
      }
      return {
        path: `${nested}/ui-edited.excalidraw`,
        revision: read.revision,
        liveElementCount: live.length,
        source: "native read_drawing after UI Cmd/Ctrl+S and debounce",
      };
    });

    await step("canvas-text-typing-survives-autosave", async () => {
      // Synthetic taps are ignored by the text tool (it needs a genuine
      // pointerup), so use the keyboard path a user also has: select the
      // drawn rectangle and press Enter to edit its label.
      const key = (k: string, extra: KeyboardEventInit = {}) =>
        doc.dispatchEvent(
          new win.KeyboardEvent("keydown", {
            key: k,
            code: k.length === 1 ? `Key${k.toUpperCase()}` : k,
            bubbles: true,
            cancelable: true,
            ...extra,
          }),
        );
      const editor = () =>
        doc.querySelector<HTMLTextAreaElement>("textarea.excalidraw-wysiwyg");
      const docIdBefore = root
        .querySelector(".vault-editor")
        ?.getAttribute("data-document-id");
      key("Escape");
      key("a", { metaKey: true, ctrlKey: true });
      await delay(win, 150);
      key("Enter");
      await delay(win, 300);
      if (!editor()) {
        throw new Error(
          `Enter on the selected rectangle did not open a text editor: ${JSON.stringify(
            {
              docIdBefore,
              docIdAfter: root
                .querySelector(".vault-editor")
                ?.getAttribute("data-document-id"),
              active: doc.activeElement?.className,
              hasFocus: doc.hasFocus(),
            },
          )}`,
        );
      }
      // A smoke-launched window may not be the key window, so focus may not
      // have been granted by the OS; focus explicitly as a user click would.
      if (doc.activeElement !== editor()) {
        editor()!.focus();
      }
      const focusedInitially = doc.activeElement === editor();
      const type = (text: string) => {
        const textarea = editor();
        if (!textarea) {
          throw new Error("WYSIWYG text editor closed while typing");
        }
        textarea.value += text;
        textarea.dispatchEvent(
          new win.InputEvent("input", {
            bubbles: true,
            inputType: "insertText",
            data: text,
          }),
        );
      };
      type("Smoke");
      // Longer than the autosave debounce so the native write and its
      // watcher echo both land while the editor is still open.
      await delay(win, 3000);
      if (!editor()) {
        throw new Error("Text editor closed after autosave");
      }
      if (focusedInitially && doc.activeElement !== editor()) {
        throw new Error("Text editor lost focus after autosave");
      }
      type(" text");
      editor()!.dispatchEvent(
        new win.KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
        }),
      );
      await delay(win, 2500);
      const read = await call("read_drawing", {
        handle: activeVault.handle,
        path: `${nested}/ui-edited.excalidraw`,
      });
      const texts = (
        (JSON.parse(read.json).elements ?? []) as Array<{
          type?: string;
          originalText?: string;
          isDeleted?: boolean;
        }>
      )
        .filter((element) => element.type === "text" && !element.isDeleted)
        // `text` is wrapped to the container width; compare what was typed.
        .map((element) => element.originalText);
      if (!texts.includes("Smoke text")) {
        throw new Error(
          `Saved source lacks typed text: ${JSON.stringify(texts)}`,
        );
      }
      return {
        savedTexts: texts,
        focusedInitially,
        gesture: "select rectangle + Enter",
        caveat:
          "text inserted via input events on the real WYSIWYG textarea, not OS keystrokes",
      };
    });

    await step("ui-switch-and-reopen-saved-drawing", async () => {
      const reopened = await call("reopen_vault");
      if (reopened !== null) {
        throw new Error(
          "Smoke reopen_vault must return None to keep onboarding deterministic",
        );
      }
      button("Close current vault and open another").click();
      await waitFor(
        "vault remains configured after UI switch",
        () =>
          root.querySelector<HTMLElement>("[data-vault-path]")?.dataset
            .vaultPath === activeVault.path,
      );
      const search = root.querySelector<HTMLInputElement>(
        '[placeholder="Search drawings..."]',
      );
      if (!search) {
        throw new Error("Tree search input missing");
      }
      const setter = Object.getOwnPropertyDescriptor(
        win.HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(search, "ui-edited");
      search.dispatchEvent(new win.Event("input", { bubbles: true }));
      await waitFor("search result", () =>
        Array.from(root.querySelectorAll(".vault-tree-item__name")).find(
          (item) => item.textContent?.includes("ui-edited"),
        ),
      );
      const result = Array.from(
        root.querySelectorAll<HTMLElement>(".vault-tree-item"),
      ).find((item) => item.textContent?.includes("ui-edited"));
      if (!result) {
        throw new Error("Search result disappeared before click");
      }
      result.click();
      await waitFor("reopened editor document", () =>
        root
          .querySelector<HTMLElement>(".vault-editor")
          ?.getAttribute("data-document-id"),
      );
      return {
        path: `${nested}/ui-edited.excalidraw`,
        actions:
          "native reopen check + UI switch button + tree search + result open",
      };
    });

    // ---- Config folder (personal/planning/config.md) ----
    await step("config-loaded", async () => {
      const loaded = await call("load_settings");
      const status = getSettingsStatus();
      if (status.mode !== "tauri") {
        throw new Error(
          `Settings are not backed by the config folder: ${JSON.stringify(
            status,
          )}`,
        );
      }
      if (/\/\.config\/vaultdraw\/?$/.test(loaded.configDir)) {
        throw new Error(
          `Smoke run is using the real config dir: ${loaded.configDir}`,
        );
      }
      if (loaded.configPath !== `${loaded.configDir}/config.toml`) {
        throw new Error(
          `configPath ${loaded.configPath} is not inside ${loaded.configDir}`,
        );
      }
      if (!loaded.statePath.endsWith("/state.json")) {
        throw new Error(`Unexpected statePath ${loaded.statePath}`);
      }
      if (loaded.configError !== null || loaded.config === null) {
        throw new Error(
          `Default config did not parse: ${JSON.stringify(loaded.configError)}`,
        );
      }
      const mismatches = diffJson(DEFAULT_CONFIG_JSON, loaded.config);
      if (mismatches.length) {
        throw new Error(`Config is not the default: ${mismatches.join("; ")}`);
      }
      if (status.problems.length) {
        throw new Error(
          `Settings problems on a default config: ${JSON.stringify(
            status.problems,
          )}`,
        );
      }
      const prefs = getPreferences(win);
      const prefMismatches = (
        [
          "theme",
          "colorTheme",
          "syncCanvas",
          "defaultCanvasBackground",
          "defaultFontFamily",
          "defaultFontSize",
          "defaultStrokeColor",
          "defaultBackgroundColor",
          "defaultFillStyle",
          "defaultStrokeWidth",
          "defaultRoughness",
          "autosaveDelayMs",
        ] as Array<keyof VaultPreferences>
      ).filter((key) => prefs[key] !== DEFAULT_PREFERENCES[key]);
      if (prefMismatches.length) {
        throw new Error(
          `In-memory preferences differ from defaults: ${prefMismatches.join(
            ", ",
          )}`,
        );
      }
      return {
        configDir: loaded.configDir,
        configPath: loaded.configPath,
        statePath: loaded.statePath,
        state: loaded.state,
      };
    });

    await step("config-gui-write-preserves-comments", async () => {
      button("Settings").click();
      const modal = await waitFor("settings modal", () =>
        doc.querySelector<HTMLElement>(".vault-settings-modal"),
      );
      const modalButton = (text: string) =>
        Array.from(modal.querySelectorAll<HTMLButtonElement>("button")).find(
          (item) => item.textContent?.trim() === text,
        ) ?? null;
      (
        await waitFor("Appearance tab", () => modalButton("Appearance & Theme"))
      ).click();
      (await waitFor("Dark theme button", () => modalButton("Dark"))).click();
      (
        await waitFor("Vault & Storage tab", () =>
          modalButton("Vault & Storage"),
        )
      ).click();
      const configRow = await waitFor("config path row", () =>
        modal.querySelector<HTMLElement>('[data-testid="settings-config-row"]'),
      );
      const shownPath =
        configRow.querySelector(".vault-config-path")?.textContent ?? null;
      const select = await waitFor("autosave select", () =>
        Array.from(modal.querySelectorAll<HTMLSelectElement>("select")).find(
          (item) =>
            Array.from(item.options).some((option) => option.value === "1000"),
        ),
      );
      const setSelect = Object.getOwnPropertyDescriptor(
        win.HTMLSelectElement.prototype,
        "value",
      )?.set;
      setSelect?.call(select, "1000");
      select.dispatchEvent(new win.Event("change", { bubbles: true }));
      if (getPreferences(win).autosaveDelayMs !== 1000) {
        throw new Error("Autosave select did not update preferences");
      }
      if (!doc.documentElement.classList.contains("dark")) {
        throw new Error("Dark theme button did not apply the dark class");
      }
      const expected = withConfig({
        appearance: { mode: "dark" },
        saving: { autosave_delay_ms: 1000 },
      });
      let loaded = await call("load_settings");
      const until = win.performance.now() + 3000;
      while (
        diffJson(expected, loaded.config).length &&
        win.performance.now() < until
      ) {
        await delay(win, 100);
        loaded = await call("load_settings");
      }
      const mismatches = diffJson(expected, loaded.config);
      if (mismatches.length) {
        throw new Error(
          `GUI edits not written to config.toml: ${mismatches.join("; ")}`,
        );
      }
      (
        await waitFor("Close Settings", () =>
          modal.querySelector<HTMLButtonElement>(
            '[aria-label="Close Settings"]',
          ),
        )
      ).click();
      await waitFor("settings modal closed", () =>
        doc.querySelector(".vault-settings-modal") ? null : true,
      );
      // Let our own write's config-change echo settle before the next step.
      await delay(win, 600);
      return {
        shownPath,
        method:
          "Settings UI: Appearance > Dark, Vault & Storage > autosave select 1000",
        commentsCheck:
          "no native file-read smoke helper; comments verified by the operator reading config.toml after the run",
      };
    });

    await step("config-external-edit-live-reload", async () => {
      let received: VaultPreferences | null = null;
      const onChanged = (event: Event) => {
        const detail = (event as CustomEvent<VaultPreferences>).detail;
        if (detail?.autosaveDelayMs === 1500) {
          received = detail;
        }
      };
      win.addEventListener(PREFERENCES_CHANGED_EVENT, onChanged);
      const startedAt = win.performance.now();
      try {
        await call("update_config", {
          changes: [{ key: "saving.autosave_delay_ms", value: 1500 }],
        });
        await waitFor(
          "vault-preferences-changed with 1500",
          () => received,
          2000,
        );
      } finally {
        win.removeEventListener(PREFERENCES_CHANGED_EVENT, onChanged);
      }
      const latencyMs = Math.round(win.performance.now() - startedAt);
      if (getPreferences(win).autosaveDelayMs !== 1500) {
        throw new Error("In-memory autosaveDelayMs not updated to 1500");
      }
      if (getPreferences(win).theme !== "dark") {
        throw new Error("Unrelated preference (theme) changed on reload");
      }
      return { latencyMs, autosaveDelayMs: 1500 };
    });

    await step("config-invalid-value-banner", async () => {
      let lastStatus: SettingsStatus | null = null;
      const onStatus = (event: Event) => {
        lastStatus = (event as CustomEvent<SettingsStatus>).detail;
      };
      win.addEventListener(SETTINGS_STATUS_EVENT, onStatus);
      try {
        await call("update_config", {
          changes: [{ key: "appearance.mode", value: "neon" }],
        });
        const banner = await waitFor(
          "settings problem banner",
          () => {
            const alert = doc.querySelector<HTMLElement>(".vault-global-alert");
            return alert?.textContent?.includes("appearance.mode")
              ? alert.textContent
              : null;
          },
          3000,
        );
        const fallbackTheme = getPreferences(win).theme;
        if (fallbackTheme !== "system") {
          throw new Error(
            `Invalid mode should fall back to "system", got ${fallbackTheme}`,
          );
        }
        if (getPreferences(win).autosaveDelayMs !== 1500) {
          throw new Error("Valid fields must keep their values");
        }
        await call("update_config", {
          changes: [{ key: "appearance.mode", value: "dark" }],
        });
        await waitFor(
          "banner cleared after fix",
          () => {
            const alert = doc.querySelector<HTMLElement>(".vault-global-alert");
            return alert?.textContent?.includes("appearance.mode")
              ? null
              : true;
          },
          3000,
        );
        await waitFor(
          "theme back to dark",
          () => (getPreferences(win).theme === "dark" ? true : null),
          3000,
        );
        return {
          banner: banner.trim(),
          fallbackTheme,
          statusProblemsAfterFix: getSettingsStatus().problems,
          sawStatusEvent: lastStatus !== null,
        };
      } finally {
        win.removeEventListener(SETTINGS_STATUS_EVENT, onStatus);
      }
    });

    // ---- Colour themes (personal/planning/themes.md "Final decisions") ----
    type Rgba = [number, number, number, number];
    const hexToRgb = (hex: string): Rgba => {
      const h = hex.trim().replace(/^#/, "");
      const full =
        h.length === 3
          ? h
              .split("")
              .map((c) => c + c)
              .join("")
          : h.slice(0, 6);
      return [
        parseInt(full.slice(0, 2), 16),
        parseInt(full.slice(2, 4), 16),
        parseInt(full.slice(4, 6), 16),
        255,
      ];
    };
    const cssRgb = (value: string): Rgba | null => {
      const m = value.match(/rgba?\(([^)]+)\)/);
      if (!m) {
        return value.trim().startsWith("#") ? hexToRgb(value) : null;
      }
      const parts = m[1]
        .split(/[\s,/]+/)
        .filter(Boolean)
        .map(Number);
      return [
        parts[0],
        parts[1],
        parts[2],
        parts.length > 3 ? parts[3] * 255 : 255,
      ];
    };
    const near = (a: Rgba | null, b: Rgba, tolerance = 2) =>
      !!a && [0, 1, 2].every((i) => Math.abs(a[i] - b[i]) <= tolerance);
    const rgbHex = (p: Rgba | null) =>
      p
        ? `#${p
            .slice(0, 3)
            .map((n) => Math.round(n).toString(16).padStart(2, "0"))
            .join("")}${p[3] < 255 ? `/a${Math.round(p[3])}` : ""}`
        : null;
    const rootVar = (name: string) =>
      doc.documentElement.style.getPropertyValue(name).trim().toLowerCase();
    const staticCanvasPixel = (): Rgba | null => {
      const canvas = root.querySelector<HTMLCanvasElement>(
        ".vault-editor canvas.static",
      );
      const ctx = canvas?.getContext("2d");
      if (!canvas || !ctx || canvas.width < 20 || canvas.height < 20) {
        return null;
      }
      // Top-left corner of the scene: islands are DOM, the rectangle sits
      // around 35% of the viewport, so this area is empty canvas background.
      const d = ctx.getImageData(12, 12, 1, 1).data;
      return [d[0], d[1], d[2], d[3]];
    };
    const waitForCanvasPixel = async (label: string, expected: string) => {
      const target = hexToRgb(expected);
      let last: Rgba | null = null;
      try {
        await waitFor(
          label,
          () => {
            last = staticCanvasPixel();
            return near(last, target) ? true : null;
          },
          5000,
        );
      } catch {
        throw new Error(
          `${label}: canvas pixel ${rgbHex(last)}, expected ${expected} ±2`,
        );
      }
      return rgbHex(last);
    };
    const openAppearanceSettings = async () => {
      if (!doc.querySelector(".vault-settings-modal")) {
        button("Settings").click();
      }
      const modal = await waitFor("settings modal", () =>
        doc.querySelector<HTMLElement>(".vault-settings-modal"),
      );
      (
        await waitFor("Appearance tab", () =>
          Array.from(modal.querySelectorAll<HTMLButtonElement>("button")).find(
            (item) => item.textContent?.trim() === "Appearance & Theme",
          ),
        )
      ).click();
      await waitFor("theme picker", () =>
        modal.querySelector('[data-testid="theme-picker"]'),
      );
      return modal;
    };
    const themeCard = (modal: HTMLElement, key: string) =>
      Array.from(
        modal.querySelectorAll<HTMLButtonElement>(".vault-theme-card"),
      ).find(
        (item) => item.dataset.themeKey?.toLowerCase() === key.toLowerCase(),
      ) ?? null;
    // The picker lists 120+ themes in a scrolling grid and renders a card's
    // preview only once it nears view, so reach a theme the way a user
    // would: type its name into the search field.
    const searchThemeCard = async (modal: HTMLElement, key: string) => {
      const input = await waitFor("theme search field", () =>
        modal.querySelector<HTMLInputElement>(".vault-theme-search__input"),
      );
      Object.getOwnPropertyDescriptor(
        win.HTMLInputElement.prototype,
        "value",
      )?.set?.call(input, key);
      input.dispatchEvent(new win.Event("input", { bubbles: true }));
      return waitFor(`${key} card after search`, () => {
        const cards = modal.querySelectorAll(".vault-theme-card");
        const card = themeCard(modal, key);
        // Wait for the deferred filter to apply and the preview to render.
        return card &&
          cards.length < 10 &&
          card.querySelector(".vault-theme-card__half")
          ? card
          : null;
      });
    };
    const closeSettings = async () => {
      const modal = doc.querySelector<HTMLElement>(".vault-settings-modal");
      if (!modal) {
        return;
      }
      modal
        .querySelector<HTMLButtonElement>('[aria-label="Close Settings"]')
        ?.click();
      await waitFor("settings modal closed", () =>
        doc.querySelector(".vault-settings-modal") ? null : true,
      );
    };
    const setSyncCanvas = async (on: boolean) => {
      const modal = await openAppearanceSettings();
      const input = await waitFor("sync canvas switch", () =>
        modal.querySelector<HTMLInputElement>("#vault-sync-canvas"),
      );
      if (input.checked !== on) {
        input.click();
      }
      await waitFor(
        `syncCanvas=${on}`,
        () =>
          getPreferences(win).syncCanvas === on &&
          doc.documentElement.dataset.vaultCanvasSync === (on ? "on" : "off")
            ? true
            : null,
        3000,
      );
      await closeSettings();
    };
    const waitForConfig = async (
      label: string,
      check: (config: typeof DEFAULT_CONFIG_JSON) => boolean,
    ) => {
      let loaded = await call("load_settings");
      const until = win.performance.now() + 3000;
      while (
        !(
          loaded.config && check(loaded.config as typeof DEFAULT_CONFIG_JSON)
        ) &&
        win.performance.now() < until
      ) {
        await delay(win, 100);
        loaded = await call("load_settings");
      }
      if (
        !loaded.config ||
        !check(loaded.config as typeof DEFAULT_CONFIG_JSON)
      ) {
        throw new Error(
          `${label}: config.toml has ${JSON.stringify(loaded.config)}`,
        );
      }
      return loaded.config as typeof DEFAULT_CONFIG_JSON;
    };
    // Theme steps are independent enough to keep going after one fails, so
    // a single regression does not hide the others; the run still fails.
    const themeStep = <T>(name: string, work: () => Promise<T>) =>
      step(name, work).catch(async () => {
        await closeSettings().catch(() => {});
      });
    const DRACULA_SURFACE = "#282a36";
    const DARK_CANVAS = "#121212";
    const TEST_PALETTE = {
      key: "Test Palette",
      mSurface: "#1b2b34",
      mOnSurface: "#d8dee9",
      mPrimary: "#ec5f67",
    };

    await themeStep("theme-user-palette-loaded", async () => {
      const { getThemeRegistry, findTheme } = await import("../theme/registry");
      const registry = getThemeRegistry();
      if (registry.mode !== "tauri") {
        throw new Error(`Theme registry not in tauri mode: ${registry.mode}`);
      }
      if (registry.loadError) {
        throw new Error(`Theme registry loadError: ${registry.loadError}`);
      }
      if (registry.fileProblems.length) {
        throw new Error(
          `Theme file problems: ${JSON.stringify(registry.fileProblems)}`,
        );
      }
      const entry = findTheme(registry, TEST_PALETTE.key);
      if (!entry || entry.source !== "user") {
        throw new Error(
          `User theme "${TEST_PALETTE.key}" not in registry: ${JSON.stringify(
            registry.themes.map((t) => `${t.source}:${t.key}`),
          )}`,
        );
      }
      const { dark, light, generated } = entry.theme;
      if (
        dark.mSurface.toLowerCase() !== TEST_PALETTE.mSurface ||
        dark.mOnSurface.toLowerCase() !== TEST_PALETTE.mOnSurface ||
        dark.mPrimary.toLowerCase() !== TEST_PALETTE.mPrimary
      ) {
        throw new Error(
          `Dark variant does not keep the file's colours: ${JSON.stringify(
            dark,
          )}`,
        );
      }
      if (!generated.light || generated.dark) {
        throw new Error(
          `Expected only light to be generated: ${JSON.stringify(generated)}`,
        );
      }
      if (!light?.mSurface || light.mSurface.toLowerCase() === dark.mSurface) {
        throw new Error(
          `Generated light variant looks wrong: ${JSON.stringify(light)}`,
        );
      }
      const modal = await openAppearanceSettings();
      const card = await searchThemeCard(modal, TEST_PALETTE.key);
      const tag = card.querySelector(".vault-theme-card__tag")?.textContent;
      const autoBadge = card.querySelector(
        '.vault-theme-card__half[data-mode="light"] .vault-theme-card__auto',
      );
      const cardWarning = card.querySelector(
        ".vault-theme-card__warning",
      )?.textContent;
      const problemList = modal.querySelector(".vault-theme-problems");
      if (!autoBadge || tag !== "Custom" || cardWarning || problemList) {
        throw new Error(
          `Settings card: ${JSON.stringify({
            tag,
            autoBadge: !!autoBadge,
            cardWarning,
            problems: problemList?.textContent,
          })}`,
        );
      }
      await closeSettings();
      return {
        key: entry.key,
        path: entry.path,
        dark: {
          mSurface: dark.mSurface,
          mOnSurface: dark.mOnSurface,
          mPrimary: dark.mPrimary,
        },
        generatedLight: {
          mSurface: light.mSurface,
          mOnSurface: light.mOnSurface,
          mPrimary: light.mPrimary,
        },
        warnings: entry.warnings,
        settingsCard: { tag, autoBadge: true },
        themeCount: registry.themes.length,
      };
    });

    await themeStep("theme-switch-applies", async () => {
      const modal = await openAppearanceSettings();
      (await searchThemeCard(modal, "Dracula")).click();
      (
        await waitFor("Dark mode button", () =>
          Array.from(modal.querySelectorAll<HTMLButtonElement>("button")).find(
            (item) => item.textContent?.trim() === "Dark",
          ),
        )
      ).click();
      await waitFor(
        "--vault-bg = Dracula surface",
        () => (rootVar("--vault-bg") === DRACULA_SURFACE ? true : null),
        3000,
      ).catch(() => {
        throw new Error(
          `--vault-bg is "${rootVar(
            "--vault-bg",
          )}", expected ${DRACULA_SURFACE}`,
        );
      });
      const prefs = getPreferences(win);
      if (prefs.colorTheme !== "Dracula" || prefs.theme !== "dark") {
        throw new Error(
          `Preferences not updated: ${prefs.colorTheme}/${prefs.theme}`,
        );
      }
      if (!doc.documentElement.classList.contains("dark")) {
        throw new Error("html.dark missing in dark mode");
      }
      await closeSettings();
      const menuBg = rootVar("--vault-menu-bg");
      const excalidrawEl = root.querySelector<HTMLElement>(
        ".vault-editor .excalidraw",
      );
      const islandVar = excalidrawEl
        ? win
            .getComputedStyle(excalidrawEl)
            .getPropertyValue("--island-bg-color")
            .trim()
        : null;
      const overrideStyle = doc.getElementById(
        "vault-theme-excalidraw-vars",
      ) as HTMLStyleElement | null;
      // Themes use a constructed stylesheet (CSP-safe); <style> is a fallback.
      const overrideSheetApplied =
        !!overrideStyle?.sheet || doc.adoptedStyleSheets.length > 0;
      // Some islands are deliberately transparent wrappers; use painted ones.
      const islands = Array.from(
        root.querySelectorAll<HTMLElement>(".vault-editor .excalidraw .Island"),
      ).map((el) => ({
        el,
        bg: win.getComputedStyle(el).backgroundColor,
      }));
      const painted = islands.filter(({ bg }) => (cssRgb(bg)?.[3] ?? 0) > 0);
      const island = painted[0];
      const diagnostics = {
        menuBg,
        islandVar,
        overrideStyleInDom: !!overrideStyle,
        overrideSheetApplied,
        islands: islands.map(({ el, bg }) => `${el.className}: ${bg}`),
      };
      if (!island) {
        throw new Error(
          `No painted Excalidraw .Island: ${JSON.stringify(diagnostics)}`,
        );
      }
      const islandBg = island.bg;
      if (!menuBg || !near(cssRgb(islandBg), hexToRgb(menuBg), 1)) {
        throw new Error(
          `Island background ${islandBg} != --vault-menu-bg ${menuBg}: ${JSON.stringify(
            diagnostics,
          )}`,
        );
      }
      const config = await waitForConfig(
        "appearance.theme=Dracula written",
        (c) => c.appearance.theme === "Dracula" && c.appearance.mode === "dark",
      );
      return {
        vaultBg: rootVar("--vault-bg"),
        vaultMenuBg: menuBg,
        islandBackground: islandBg,
        islandClass: island.el.className,
        islandVar,
        overrideSheetApplied,
        configAppearance: config.appearance,
      };
    });

    await themeStep("theme-sync-canvas-pixels", async () => {
      // Make sure the drawing is open and its canvas is laid out.
      await waitFor("static canvas", () => staticCanvasPixel());
      const before = rgbHex(staticCanvasPixel());
      await setSyncCanvas(true);
      const syncedPixel = await waitForCanvasPixel(
        "sync on: canvas = Dracula surface",
        DRACULA_SURFACE,
      );
      await waitForConfig(
        "sync_canvas=true written",
        (c) => c.appearance.sync_canvas === true,
      );
      await setSyncCanvas(false);
      const standardPixel = await waitForCanvasPixel(
        "sync off: canvas = standard dark",
        DARK_CANVAS,
      );
      return {
        pixelAt: "static canvas (12,12) device px",
        beforeSync: before,
        syncOn: syncedPixel,
        syncOff: standardPixel,
        expected: { syncOn: DRACULA_SURFACE, syncOff: DARK_CANVAS },
      };
    });

    await themeStep("theme-export-keeps-standard-colours", async () => {
      const { getThemeRegistry, findTheme } = await import("../theme/registry");
      const dracula = findTheme(getThemeRegistry(), "Dracula");
      if (!dracula) {
        throw new Error("Dracula missing from registry");
      }
      const draculaColours = new Set(
        [
          dracula.theme.dark.mSurface,
          dracula.theme.dark.mOnSurface,
          dracula.theme.light.mSurface,
          dracula.theme.light.mOnSurface,
        ].map((c) => c.toLowerCase()),
      );
      const drawingPath = `${nested}/ui-edited.excalidraw`;

      // Real menu path: Main menu > Export as … (VaultEditor wraps it in
      // withStandardCanvasColors). Capture the bytes; still write natively.
      let exportCount = 0;
      const exportViaMenu = async (label: string) => {
        const originalExport = desktopRepository.exportFile;
        let captured: { name: string; bytes: Uint8Array } | null = null;
        let nativeResult: boolean | null = null;
        let nativeError: string | null = null;
        desktopRepository.exportFile = async (
          name: string,
          bytes: Uint8Array,
        ) => {
          captured = { name, bytes };
          // The smoke sandbox refuses to overwrite: give each export its own
          // name (the menu always proposes "<drawing>.<ext>").
          exportCount += 1;
          try {
            nativeResult = await originalExport.call(
              desktopRepository,
              `theme-${exportCount}-${name}`,
              bytes,
            );
          } catch (error) {
            nativeError = String(error);
            throw error;
          }
          return nativeResult;
        };
        try {
          const trigger = await waitFor("main menu trigger", () =>
            root.querySelector<HTMLElement>(
              '.vault-editor [data-testid="main-menu-trigger"]',
            ),
          );
          trigger.click();
          const item = await waitFor(`${label} menu item`, () =>
            Array.from(
              doc.querySelectorAll<HTMLElement>(
                ".excalidraw .dropdown-menu-item",
              ),
            ).find((el) => el.textContent?.includes(label)),
          );
          item.click();
          await waitFor(`${label} captured`, () => captured, 8000);
          await waitFor(
            `${label} native write`,
            () => {
              if (nativeError) {
                throw new Error(`${label} native write failed: ${nativeError}`);
              }
              return nativeResult;
            },
            8000,
          );
        } finally {
          desktopRepository.exportFile = originalExport;
        }
        const result = captured as unknown as {
          name: string;
          bytes: Uint8Array;
        };
        return { ...result, nativeWritten: nativeResult };
      };
      const pngCornerPixel = async (bytes: Uint8Array) => {
        const signature = Array.from(bytes.slice(0, 4));
        if (signature.join(",") !== "137,80,78,71") {
          throw new Error(`Export is not a PNG: ${signature}`);
        }
        const bitmap = await win.createImageBitmap(
          new win.Blob([bytes as BlobPart], { type: "image/png" }),
        );
        const scratch = doc.createElement("canvas");
        scratch.width = bitmap.width;
        scratch.height = bitmap.height;
        const sctx = scratch.getContext("2d")!;
        sctx.drawImage(bitmap, 0, 0);
        const d = sctx.getImageData(2, 2, 1, 1).data;
        return {
          pixel: [d[0], d[1], d[2], d[3]] as Rgba,
          size: `${bitmap.width}x${bitmap.height}`,
        };
      };
      const setMode = async (label: "Light" | "Dark") => {
        const modal = await openAppearanceSettings();
        (
          await waitFor(`${label} mode button`, () =>
            Array.from(
              modal.querySelectorAll<HTMLButtonElement>("button"),
            ).find((item) => item.textContent?.trim() === label),
          )
        ).click();
        await waitFor(
          `html.dark=${label === "Dark"}`,
          () =>
            doc.documentElement.classList.contains("dark") ===
            (label === "Dark")
              ? true
              : null,
          3000,
        );
        await closeSettings();
      };

      // A. Dark mode. Upstream Excalidraw exports in the editor theme
      //    (App.tsx keeps exportWithDarkMode = theme === dark), so the
      //    standard dark export background is #121212. Baseline with sync
      //    off, then with sync on: must be identical, never Dracula.
      await setSyncCanvas(false);
      await waitForCanvasPixel("sync off baseline", DARK_CANVAS);
      const baseline = await exportViaMenu("Export as PNG");
      const baselinePng = await pngCornerPixel(baseline.bytes);
      await setSyncCanvas(true);
      await waitForCanvasPixel("sync on before export", DRACULA_SURFACE);
      const darkExport = await exportViaMenu("Export as PNG");
      const darkPng = await pngCornerPixel(darkExport.bytes);
      if (
        !near(darkPng.pixel, baselinePng.pixel, 0) ||
        !near(darkPng.pixel, hexToRgb(DARK_CANVAS)) ||
        darkPng.pixel[3] !== 255
      ) {
        throw new Error(
          `Dark PNG with sync on ${rgbHex(
            darkPng.pixel,
          )}, sync-off baseline ${rgbHex(
            baselinePng.pixel,
          )}, expected standard ${DARK_CANVAS} (not ${DRACULA_SURFACE})`,
        );
      }
      const afterDarkExport = await waitForCanvasPixel(
        "sync restored after dark export",
        DRACULA_SURFACE,
      );

      // B. Light mode: canvas shows Dracula's light surface; PNG/SVG must
      //    carry the drawing's own #ffffff and #1e1e1e.
      await setMode("Light");
      const lightCanvas = await waitForCanvasPixel(
        "sync on light: canvas = Dracula light surface",
        dracula.theme.light.mSurface,
      );
      const lightExport = await exportViaMenu("Export as PNG");
      const lightPng = await pngCornerPixel(lightExport.bytes);
      if (
        !near(lightPng.pixel, hexToRgb("#ffffff")) ||
        lightPng.pixel[3] !== 255
      ) {
        throw new Error(
          `Light PNG background ${rgbHex(
            lightPng.pixel,
          )}, expected the drawing's #ffffff (not ${
            dracula.theme.light.mSurface
          })`,
        );
      }
      svgExportInFlight = true;
      const svgExport = await exportViaMenu("Export as SVG").finally(() =>
        delay(win, 200).then(() => {
          svgExportInFlight = false;
        }),
      );
      const svgText = new win.TextDecoder().decode(svgExport.bytes);
      const svgColours = Array.from(
        new Set(
          (svgText.match(/#[0-9a-fA-F]{6}\b/g) ?? []).map((c) =>
            c.toLowerCase(),
          ),
        ),
      );
      const svgThemed = svgColours.filter((c) => draculaColours.has(c));
      if (
        svgThemed.length ||
        !svgColours.includes("#ffffff") ||
        !svgColours.includes("#1e1e1e")
      ) {
        throw new Error(
          `SVG colours ${JSON.stringify(svgColours)} (themed: ${JSON.stringify(
            svgThemed,
          )}); expected #ffffff + #1e1e1e and no Dracula colours`,
        );
      }
      const afterLightExport = await waitForCanvasPixel(
        "sync restored after light export",
        dracula.theme.light.mSurface,
      );
      await setMode("Dark");
      await waitForCanvasPixel("back to dark Dracula canvas", DRACULA_SURFACE);
      const beforeEdit = await call("read_drawing", {
        handle: activeVault.handle,
        path: drawingPath,
      });
      const exported = {
        darkBaselineSyncOff: rgbHex(baselinePng.pixel),
        darkSyncOn: rgbHex(darkPng.pixel),
        canvasAfterDarkExport: afterDarkExport,
        lightCanvasSyncOn: lightCanvas,
        lightPngSyncOn: rgbHex(lightPng.pixel),
        canvasAfterLightExport: afterLightExport,
        pngSize: lightPng.size,
        svgColours,
        files: [baseline, darkExport, lightExport, svgExport].map(
          (e) => `${e.name} (${e.bytes.length} B, native=${e.nativeWritten})`,
        ),
      };

      // 2. Edit while sync is on (nudge everything 1px), then check the file
      //    on disk keeps standard colours.
      const key = (k: string, extra: KeyboardEventInit = {}) =>
        doc.dispatchEvent(
          new win.KeyboardEvent("keydown", {
            key: k,
            code: k,
            bubbles: true,
            cancelable: true,
            ...extra,
          }),
        );
      key("Escape");
      key("a", { metaKey: true, ctrlKey: true, code: "KeyA" });
      await delay(win, 150);
      key("ArrowRight");
      await delay(win, 150);
      key("Escape");
      let after = await call("read_drawing", {
        handle: activeVault.handle,
        path: drawingPath,
      });
      const until = win.performance.now() + 6000;
      while (
        after.revision === beforeEdit.revision &&
        win.performance.now() < until
      ) {
        await delay(win, 250);
        after = await call("read_drawing", {
          handle: activeVault.handle,
          path: drawingPath,
        });
      }
      const savedWhileSynced = after.revision !== beforeEdit.revision;
      const scene = JSON.parse(after.json) as {
        appState?: { viewBackgroundColor?: string };
        elements?: Array<{
          type: string;
          isDeleted?: boolean;
          strokeColor?: string;
          backgroundColor?: string;
        }>;
      };
      const live = (scene.elements ?? []).filter((e) => !e.isDeleted);
      const strokes = Array.from(new Set(live.map((e) => e.strokeColor)));
      const fills = Array.from(new Set(live.map((e) => e.backgroundColor)));
      const viewBg = scene.appState?.viewBackgroundColor;
      if (viewBg !== "#ffffff") {
        throw new Error(
          `Saved viewBackgroundColor ${viewBg}, expected #ffffff`,
        );
      }
      if (strokes.some((s) => s !== "#1e1e1e")) {
        throw new Error(
          `Saved stroke colours ${JSON.stringify(strokes)}, expected #1e1e1e`,
        );
      }
      if (fills.some((f) => f !== "transparent")) {
        throw new Error(
          `Saved fill colours ${JSON.stringify(fills)}, expected transparent`,
        );
      }
      return {
        exports: exported,
        savedWhileSynced,
        savedRevision: after.revision,
        viewBackgroundColor: viewBg,
        strokeColors: strokes,
        fillColors: fills,
      };
    });

    await themeStep("theme-user-palette-applies", async () => {
      const modal = await openAppearanceSettings();
      (await searchThemeCard(modal, TEST_PALETTE.key)).click();
      await waitFor(
        "--vault-bg = Test Palette mSurface",
        () => (rootVar("--vault-bg") === TEST_PALETTE.mSurface ? true : null),
        3000,
      ).catch(() => {
        throw new Error(
          `--vault-bg is "${rootVar("--vault-bg")}", expected ${
            TEST_PALETTE.mSurface
          }`,
        );
      });
      await closeSettings();
      const canvasPixel = await waitForCanvasPixel(
        "sync on: canvas = Test Palette surface",
        TEST_PALETTE.mSurface,
      );
      const config = await waitForConfig(
        "appearance.theme=Test Palette written",
        (c) => c.appearance.theme === TEST_PALETTE.key,
      );
      const banner = doc.querySelector(".vault-global-alert")?.textContent;
      if (banner && /theme/i.test(banner)) {
        throw new Error(`Theme problem banner shown: ${banner}`);
      }
      return {
        vaultBg: rootVar("--vault-bg"),
        vaultText: rootVar("--vault-text"),
        vaultPrimary: rootVar("--vault-primary"),
        canvasPixel,
        dataVaultTheme: doc.documentElement.dataset.vaultTheme,
        configTheme: config.appearance.theme,
      };
    });

    await step("theme-reset-defaults", async () => {
      await call("update_config", {
        changes: [
          { key: "appearance.theme", value: "Default" },
          { key: "appearance.mode", value: "system" },
          { key: "appearance.sync_canvas", value: false },
          { key: "saving.autosave_delay_ms", value: 500 },
        ],
      });
      await waitFor(
        "preferences back to defaults",
        () => {
          const p = getPreferences(win);
          return p.colorTheme === "Default" &&
            p.theme === "system" &&
            !p.syncCanvas &&
            p.autosaveDelayMs === 500
            ? true
            : null;
        },
        3000,
      );
      const loaded = await call("load_settings");
      const mismatches = diffJson(DEFAULT_CONFIG_JSON, loaded.config);
      if (mismatches.length) {
        throw new Error(`Config not reset: ${mismatches.join("; ")}`);
      }
      await waitFor(
        "Default theme tokens removed",
        () => (rootVar("--vault-bg") === "" ? true : null),
        3000,
      ).catch(() => {
        throw new Error(
          `--vault-bg still "${rootVar("--vault-bg")}" after Default`,
        );
      });
      return {
        config: "defaults",
        canvasSync: doc.documentElement.dataset.vaultCanvasSync,
      };
    });

    const failed = records.filter((record) => !record.ok);
    if (failed.length) {
      throw new Error(
        `Failed steps: ${failed.map((record) => record.step).join(", ")}`,
      );
    }
    if (pageErrors.length) {
      throw new Error(`WebView reported errors: ${JSON.stringify(pageErrors)}`);
    }
    exitStatus = 0;
  } catch (error) {
    records.push({
      step: "harness-failure",
      ok: false,
      details: String(error),
    });
  } finally {
    restoreStorage();
    win.removeEventListener("error", onError);
    win.removeEventListener("unhandledrejection", onRejection);
    doc.removeEventListener("securitypolicyviolation", onCsp);
    const elapsedMs = Math.round(win.performance.now() - startedAt);
    const report = {
      elapsedMs,
      records,
      pageErrors,
      knownCspReports,
      vaultPath: vaultForReport?.path ?? null,
      limitations: [
        "Uses synthetic pointer input; this does not establish physical mouse, trackpad, accessibility, or automation parity.",
        "Folder/file IPC fixture provisioning is explicitly distinct from the UI-created drawing saved through the real editor.",
      ],
    };
    try {
      for (const record of records) {
        await call("smoke_log", {
          step: record.step,
          ok: record.ok,
          details: record.details,
        });
      }
      await call("smoke_finish", { status: exitStatus, details: report });
    } catch (finishError) {
      console.error(
        "Desktop smoke could not write/finish native report",
        finishError,
        report,
      );
    }
  }
}
