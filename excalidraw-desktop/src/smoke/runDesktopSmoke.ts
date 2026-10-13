import { desktopRepository } from "../vault/DesktopVaultRepository";

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
  smoke_environment: () => Promise<SmokeEnvironment>;
  smoke_log: (args: {
    step: string;
    ok: boolean;
    details?: unknown;
  }) => Promise<void>;
  smoke_finish: (args: { status: number; details?: unknown }) => Promise<void>;
};

const timeout = 12_000;
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
  const onCsp = (event: SecurityPolicyViolationEvent) =>
    pageErrors.push({
      type: "csp",
      message: `${event.violatedDirective}: ${event.blockedURI}`,
    });
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
            const path = root.querySelector<HTMLElement>(
              ".vault-navigator__subtitle",
            )?.title;
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
          root.querySelector<HTMLElement>(".vault-navigator__subtitle")
            ?.title === activeVault.path,
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
