/**
 * useVaultDocument behavior tests against the REAL production hook
 * (`../vault/useVaultDocument.ts`) with FakeVaultRepository as the backend.
 *
 * Covers:
 * - open/create/change/flush/close/reload/saveCopy/relocate signatures
 * - document.json stays the load snapshot; edits live in internal currentJson
 * - flush-before-navigation: open/create/close/relocate flush first; on flush
 *   failure the current document stays intact and the call rejects
 * - rapid A -> B -> C navigation: generation IDs reject stale load results
 * - external conflict (dirty + disk change -> conflict) vs clean auto-reload
 * - external deletion -> conflict, saving to old path disabled
 * - saveCopy resolves conflicts by switching to the copy
 *
 * Lightweight: no editor mount, no root setupTests.ts.
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useVaultDocument } from "../vault/useVaultDocument";

import { FakeVaultRepository } from "./fakeVaultRepository";
import { BLANK_SCENE, editedSampleScene, SAMPLE_SCENE } from "./fixtures";

const vaultOf = (repo: FakeVaultRepository) => ({ ...repo.vault });

async function openPath(
  hook: { current: ReturnType<typeof useVaultDocument> },
  path: string,
) {
  await act(async () => {
    await hook.current.open(path);
  });
}

describe("useVaultDocument open/create/change/flush", () => {
  it("opens a drawing; document.json is the load snapshot, not live edits", async () => {
    const repo = new FakeVaultRepository();
    repo.seedDrawing("a.excalidraw", SAMPLE_SCENE);
    const { result } = renderHook(() => useVaultDocument(repo, vaultOf(repo)));
    await openPath(result, "a.excalidraw");
    expect(result.current.document?.path).toBe("a.excalidraw");
    expect(result.current.document?.json).toBe(SAMPLE_SCENE);
    expect(result.current.status).toBe("saved");

    act(() => result.current.change(BLANK_SCENE));
    expect(result.current.status).toBe("dirty");
    // Snapshot stays stable so the editor is not reset on every keystroke.
    expect(result.current.document?.json).toBe(SAMPLE_SCENE);
    await act(async () => {
      await result.current.flush();
    });
    expect(result.current.status).toBe("saved");
    const disk = await repo.readDrawing(repo.handle, "a.excalidraw");
    expect(disk.json).toBe(BLANK_SCENE);
  });

  it("create() uses create-only writes and activates the new document", async () => {
    const repo = new FakeVaultRepository();
    const { result } = renderHook(() => useVaultDocument(repo, vaultOf(repo)));
    await act(async () => {
      await result.current.create("DSA", "1D DP.excalidraw");
    });
    expect(result.current.document?.path).toBe("DSA/1D DP.excalidraw");
    expect(repo.writeCalls[0]).toMatchObject({
      path: "DSA/1D DP.excalidraw",
      expectedRevision: null,
    });
    // Second create at the same path must fail (never overwrite).
    await expect(
      act(async () => {
        await result.current.create("DSA", "1D DP.excalidraw");
      }),
    ).rejects.toThrow();
  });

  it("throws a readable error when no vault is chosen", async () => {
    const repo = new FakeVaultRepository();
    const { result } = renderHook(() => useVaultDocument(repo, null));
    await expect(
      act(async () => {
        await result.current.open("a.excalidraw");
      }),
    ).rejects.toThrow(/vault/i);
  });

  it("close() flushes then clears; reload() drops dirty state for the disk version", async () => {
    const repo = new FakeVaultRepository();
    repo.seedDrawing("a.excalidraw", SAMPLE_SCENE);
    const { result } = renderHook(() => useVaultDocument(repo, vaultOf(repo)));
    await openPath(result, "a.excalidraw");
    act(() => result.current.change(BLANK_SCENE));
    await act(async () => {
      await result.current.close();
    });
    expect(result.current.document).toBeNull();
    const disk = await repo.readDrawing(repo.handle, "a.excalidraw");
    expect(disk.json).toBe(BLANK_SCENE); // close flushed

    await openPath(result, "a.excalidraw");
    act(() => result.current.change(SAMPLE_SCENE));
    expect(result.current.status).toBe("dirty");
    await act(async () => {
      await result.current.reload();
    });
    // reload deliberately drops dirty edits (UI confirms first).
    expect(result.current.document?.json).toBe(BLANK_SCENE);
    expect(result.current.status).toBe("saved");
  });
});

describe("rapid navigation and dirty-switch failures", () => {
  it("rapid A -> B -> C navigation keeps only the last document (stale loads rejected)", async () => {
    const repo = new FakeVaultRepository({ latencyMs: 40 });
    repo.seedDrawing("a.excalidraw", SAMPLE_SCENE);
    repo.seedDrawing("b.excalidraw", BLANK_SCENE);
    repo.seedDrawing("c.excalidraw", editedSampleScene());
    const { result } = renderHook(() => useVaultDocument(repo, vaultOf(repo)));
    await act(async () => {
      const p1 = result.current.open("a.excalidraw");
      const p2 = result.current.open("b.excalidraw");
      const p3 = result.current.open("c.excalidraw");
      await Promise.allSettled([p1, p2, p3]);
    });
    // Generation IDs reject stale A/B results; C wins.
    expect(result.current.document?.path).toBe("c.excalidraw");
    expect(result.current.document?.json).toBe(editedSampleScene());
  });

  it("failed flush before navigation keeps the current document intact", async () => {
    const repo = new FakeVaultRepository();
    repo.seedDrawing("a.excalidraw", SAMPLE_SCENE);
    repo.seedDrawing("b.excalidraw", BLANK_SCENE);
    const { result } = renderHook(() => useVaultDocument(repo, vaultOf(repo)));
    await openPath(result, "a.excalidraw");
    act(() => result.current.change(editedSampleScene()));
    repo.failWrites = true; // next flush (inside open) fails
    let openError: unknown;
    try {
      await act(async () => {
        await result.current.open("b.excalidraw");
      });
    } catch (e) {
      openError = e;
    }
    expect(openError).toBeDefined();
    expect((openError as Error).message).toMatch(/simulated disk full/);
    // Still on A with the dirty edit preserved, never silently abandoned.
    expect(result.current.document?.path).toBe("a.excalidraw");
    repo.failWrites = false;
    await act(async () => {
      await result.current.flush();
    });
    await openPath(result, "b.excalidraw");
    expect(result.current.document?.path).toBe("b.excalidraw");
  });
});

describe("external conflicts and deletion", () => {
  it("clean document auto-reloads on external change; dirty document enters conflict", async () => {
    const repo = new FakeVaultRepository();
    repo.seedDrawing("a.excalidraw", SAMPLE_SCENE);
    const { result } = renderHook(() => useVaultDocument(repo, vaultOf(repo)));
    await openPath(result, "a.excalidraw");

    // Clean: external edit is adopted after validation.
    act(() => {
      repo.externalWrite("a.excalidraw", BLANK_SCENE);
    });
    await waitFor(() =>
      expect(result.current.document?.json).toBe(BLANK_SCENE),
    );
    expect(result.current.status).toBe("saved");

    // Dirty: external edit becomes an explicit conflict, no autosave-over.
    act(() => result.current.change(editedSampleScene()));
    act(() => {
      repo.externalWrite("a.excalidraw", SAMPLE_SCENE);
    });
    await waitFor(() => expect(result.current.status).toBe("conflict"));
    expect(result.current.error).toMatch(/outside the editor/i);
    // Disk keeps the external version; memory keeps the user edit.
    const disk = await repo.readDrawing(repo.handle, "a.excalidraw");
    expect(disk.json).toBe(SAMPLE_SCENE);
  });

  it("external deletion stops writes to the old path and offers save-a-copy", async () => {
    const repo = new FakeVaultRepository();
    repo.seedDrawing("a.excalidraw", SAMPLE_SCENE);
    const { result } = renderHook(() => useVaultDocument(repo, vaultOf(repo)));
    await openPath(result, "a.excalidraw");
    act(() => result.current.change(BLANK_SCENE));
    act(() => {
      repo.externalDelete("a.excalidraw");
    });
    await waitFor(() => expect(result.current.status).toBe("conflict"));
    expect(result.current.error).toMatch(/deleted/i);

    // saveCopy writes the in-memory scene to a NEW path without overwrite.
    await act(async () => {
      await result.current.saveCopy("rescued.excalidraw");
    });
    expect(result.current.document?.path).toBe("rescued.excalidraw");
    const rescued = await repo.readDrawing(repo.handle, "rescued.excalidraw");
    expect(rescued.json).toBe(BLANK_SCENE);
  });

  it("ignores watcher events for unrelated paths and other vault handles", async () => {
    const repo = new FakeVaultRepository();
    repo.seedDrawing("a.excalidraw", SAMPLE_SCENE);
    repo.seedDrawing("other.excalidraw", BLANK_SCENE);
    const { result } = renderHook(() => useVaultDocument(repo, vaultOf(repo)));
    await openPath(result, "a.excalidraw");
    act(() => {
      repo.externalWrite("other.excalidraw", SAMPLE_SCENE);
      repo.emit({
        handle: "different-handle",
        paths: ["a.excalidraw"],
        rescan: false,
      });
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(result.current.document?.json).toBe(SAMPLE_SCENE);
    expect(result.current.status).toBe("saved");
  });
});

describe("saveCopy and relocate", () => {
  it("saveCopy switches to the copy; relocate follows file and folder moves", async () => {
    const repo = new FakeVaultRepository();
    repo.seedDrawing("a.excalidraw", SAMPLE_SCENE);
    const { result } = renderHook(() => useVaultDocument(repo, vaultOf(repo)));
    await openPath(result, "a.excalidraw");
    act(() => result.current.change(BLANK_SCENE));

    await act(async () => {
      await result.current.saveCopy("copy.excalidraw");
    });
    expect(result.current.document?.path).toBe("copy.excalidraw");
    expect((await repo.readDrawing(repo.handle, "copy.excalidraw")).json).toBe(
      BLANK_SCENE,
    );

    await act(async () => {
      await result.current.relocate("copy.excalidraw", "DSA/moved.excalidraw");
    });
    expect(result.current.document?.path).toBe("DSA/moved.excalidraw");
  });

  it("relocate follows ancestor folder moves", async () => {
    const repo = new FakeVaultRepository();
    repo.seedDrawing("DSA/a.excalidraw", SAMPLE_SCENE);
    const { result } = renderHook(() => useVaultDocument(repo, vaultOf(repo)));
    await openPath(result, "DSA/a.excalidraw");
    await act(async () => {
      await result.current.relocate("DSA", "Algo");
    });
    expect(result.current.document?.path).toBe("Algo/a.excalidraw");
  });
});
