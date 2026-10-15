/**
 * useHistorySync against the REAL useVaultDocument and the fakes: `opened` is
 * sent only after a document change completed (flush of the previous drawing
 * first), never for a reload of the same document, a move, or an autosave.
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  HISTORY_DEFAULTS,
  toHistorySettings,
} from "../history/historySettings";
import { useHistorySync } from "../history/useHistorySync";
import { useVaultDocument } from "../vault/useVaultDocument";

import { FakeHistoryRepository } from "./fakeHistoryRepository";
import { FakeVaultRepository } from "./fakeVaultRepository";
import { BLANK_SCENE, SAMPLE_SCENE } from "./fixtures";

const SETTINGS = toHistorySettings(HISTORY_DEFAULTS);

const setup = (initialSettings = SETTINGS) => {
  const repo = new FakeVaultRepository();
  repo.seedDrawing("a.excalidraw", SAMPLE_SCENE);
  repo.seedDrawing("b.excalidraw", SAMPLE_SCENE);
  const history = new FakeHistoryRepository(repo.handle);
  // One ordered log across vault writes and history calls.
  const log: string[] = [];
  const write = repo.writeDrawing.bind(repo);
  repo.writeDrawing = async (input) => {
    const result = await write(input);
    history.noteCommitted(input.handle, input.path, input.json);
    log.push(`write:${input.path}`);
    return result;
  };
  for (const method of ["configure", "opened"] as const) {
    const original = history[method].bind(history) as (
      ...a: any[]
    ) => Promise<void>;
    (history as any)[method] = async (...args: any[]) => {
      log.push(
        method === "opened" ? `opened:${args[1]}:${args[2]}` : "configure",
      );
      return original(...args);
    };
  }
  const vault = { ...repo.vault };
  const hook = renderHook(
    ({ settings }) => {
      const doc = useVaultDocument(repo, vault, { autosaveDelayMs: 20 });
      useHistorySync(history, vault, settings, doc.document);
      return doc;
    },
    { initialProps: { settings: initialSettings } },
  );
  return { repo, history, log, hook };
};

const open = (hook: ReturnType<typeof setup>["hook"], path: string) =>
  act(async () => {
    await hook.result.current.open(path);
  });
const settle = () =>
  act(async () => void (await new Promise((r) => setTimeout(r, 30))));

describe("useHistorySync", () => {
  it("configures on vault open, before anything else, and sends no opened without a drawing", async () => {
    const { log } = setup();
    await waitFor(() => expect(log).toEqual(["configure"]));
  });

  it("sends opened with path and revision after the drawing is loaded", async () => {
    const { hook, history, repo } = setup();
    await open(hook, "a.excalidraw");
    await waitFor(() => expect(history.openedLog).toHaveLength(1));
    const { revision } = await repo.readDrawing(repo.handle, "a.excalidraw");
    expect(history.openedLog[0]).toEqual({ path: "a.excalidraw", revision });
  });

  it("flushes the previous drawing before reporting the next", async () => {
    const { hook, log } = setup();
    await open(hook, "a.excalidraw");
    await waitFor(() =>
      expect(log.filter((e) => e.startsWith("opened"))).toHaveLength(1),
    );
    act(() => hook.result.current.change(BLANK_SCENE));
    await open(hook, "b.excalidraw");
    await waitFor(() =>
      expect(log.filter((e) => e.startsWith("opened"))).toHaveLength(2),
    );
    const writeIdx = log.indexOf("write:a.excalidraw");
    const openedB = log.findIndex((e) => e.startsWith("opened:b.excalidraw"));
    expect(writeIdx).toBeGreaterThan(-1);
    expect(writeIdx).toBeLessThan(openedB);
  });

  it("makes a leave version when switching away from a dirty drawing", async () => {
    const { hook, history } = setup();
    await open(hook, "a.excalidraw");
    act(() => hook.result.current.change(BLANK_SCENE));
    await open(hook, "b.excalidraw");
    await waitFor(() => expect(history.openedLog).toHaveLength(2));
    expect(
      (await history.list("fake-handle-1", "a.excalidraw")).versions.map(
        (v) => v.reason,
      ),
    ).toEqual(["leave"]);
  });

  it("does not send opened for a reload of the same document", async () => {
    const { hook, history } = setup();
    await open(hook, "a.excalidraw");
    await waitFor(() => expect(history.openedLog).toHaveLength(1));
    await act(async () => {
      await hook.result.current.reload();
    });
    await settle();
    expect(history.openedLog).toHaveLength(1);
  });

  it("does not send opened when an outside change reloads the open drawing", async () => {
    const { hook, history, repo } = setup();
    await open(hook, "a.excalidraw");
    await waitFor(() => expect(history.openedLog).toHaveLength(1));
    const before = hook.result.current.document!.id;
    await act(async () => {
      repo.externalWrite("a.excalidraw", BLANK_SCENE);
      await new Promise((r) => setTimeout(r, 30));
    });
    await waitFor(() =>
      expect(hook.result.current.document!.id).not.toBe(before),
    );
    expect(history.openedLog).toHaveLength(1);
  });

  it("does not send opened for an in-app move", async () => {
    const { hook, history } = setup();
    await open(hook, "a.excalidraw");
    await waitFor(() => expect(history.openedLog).toHaveLength(1));
    await act(async () => {
      await hook.result.current.relocate("a.excalidraw", "moved.excalidraw");
    });
    expect(hook.result.current.document!.path).toBe("moved.excalidraw");
    await settle();
    expect(history.openedLog).toHaveLength(1);
  });

  it("sends zero history calls during autosave", async () => {
    const { hook, history, repo } = setup();
    await open(hook, "a.excalidraw");
    await waitFor(() => expect(history.openedLog).toHaveLength(1));
    const calls = [...history.calls];
    for (let i = 0; i < 5; i++) {
      act(() =>
        hook.result.current.change(
          i % 2 ? SAMPLE_SCENE : BLANK_SCENE.replace("{}", `{"n":${i}}`),
        ),
      );
      await settle();
    }
    await waitFor(() =>
      expect(repo.writeCalls.length).toBeGreaterThanOrEqual(3),
    );
    expect(history.calls).toEqual(calls);
  });

  it("reports save-as-copy as a new document and close as null", async () => {
    const { hook, history } = setup();
    await open(hook, "a.excalidraw");
    await act(async () => {
      await hook.result.current.saveCopy("copy.excalidraw");
    });
    await waitFor(() => expect(history.openedLog).toHaveLength(2));
    expect(history.openedLog[1].path).toBe("copy.excalidraw");
    await act(async () => {
      await hook.result.current.close();
    });
    await waitFor(() => expect(history.openedLog).toHaveLength(3));
    expect(history.openedLog[2]).toEqual({ path: null, revision: null });
  });

  it("re-configures when the effective settings change, not when they are re-created", async () => {
    const { hook, history } = setup();
    await waitFor(() =>
      expect(history.calls.filter((c) => c === "configure")).toHaveLength(1),
    );
    hook.rerender({ settings: { ...SETTINGS } });
    await settle();
    expect(history.calls.filter((c) => c === "configure")).toHaveLength(1);
    hook.rerender({ settings: { ...SETTINGS, enabled: false } });
    await waitFor(() => expect(history.settings?.enabled).toBe(false));
    expect(history.calls.filter((c) => c === "configure")).toHaveLength(2);
  });

  it("never throws when history fails", async () => {
    const { hook, history } = setup();
    history.opened = async () => {
      throw new Error("native down");
    };
    await open(hook, "a.excalidraw");
    await open(hook, "b.excalidraw");
    expect(hook.result.current.document?.path).toBe("b.excalidraw");
  });
});
