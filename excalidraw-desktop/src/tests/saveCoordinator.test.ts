/**
 * SaveCoordinator behavior tests against the REAL production module
 * (`../vault/saveCoordinator.ts`) with FakeVaultRepository as the backend.
 *
 * Covers: save coalescing (many edits -> one write with the newest snapshot),
 * flush as a durability barrier, flush failure rejection + recovery,
 * in-flight edit handling, debounce/max-wait scheduling, and stop semantics.
 *
 * Lightweight: no editor deps, no root setupTests.ts.
 */
import { describe, expect, it } from "vitest";

import { SaveCoordinator } from "../vault/saveCoordinator";

import { FakeVaultRepository } from "./fakeVaultRepository";
import { BLANK_SCENE, editedSampleScene, SAMPLE_SCENE } from "./fixtures";

const PATH = "DSA/1D DP.excalidraw";

function setup(
  options: { idleMs?: number; maxWaitMs?: number; latencyMs?: number } = {},
) {
  const repo = new FakeVaultRepository({ latencyMs: options.latencyMs ?? 0 });
  const seedRevision = repo.seedDrawing(PATH, SAMPLE_SCENE);
  let currentJson = SAMPLE_SCENE;
  let revision = seedRevision;
  const statuses: string[] = [];
  const errors: unknown[] = [];
  const coordinator = new SaveCoordinator({
    repository: repo,
    target: () => ({
      handle: repo.handle,
      path: PATH,
      documentId: "doc-1",
      revision,
    }),
    snapshot: () => currentJson,
    onStatus: (status, cause) => {
      statuses.push(status);
      if (cause) {
        errors.push(cause);
      }
    },
    onSaved: (next) => {
      revision = next;
    },
    idleMs: options.idleMs ?? 15,
    maxWaitMs: options.maxWaitMs ?? 120,
  });
  return {
    repo,
    coordinator,
    statuses,
    errors,
    edit: (json: string) => {
      currentJson = json;
      coordinator.schedule();
    },
    currentJson: () => currentJson,
    revision: () => revision,
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("save coalescing", () => {
  it("coalesces rapid edits into a single write with the newest snapshot", async () => {
    const t = setup();
    const latest = editedSampleScene();
    t.edit(BLANK_SCENE);
    t.edit(SAMPLE_SCENE);
    t.edit(latest);
    await t.coordinator.flush();
    expect(t.repo.writeCalls).toHaveLength(1);
    const disk = await t.repo.readDrawing(t.repo.handle, PATH);
    expect(disk.json).toBe(latest);
    expect(disk.revision).toBe(t.revision());
    expect(t.statuses).toContain("saving");
    expect(t.statuses[t.statuses.length - 1]).toBe("saved");
  });

  it("schedule() alone performs no synchronous write (debounce is scheduling, not durability)", async () => {
    const t = setup();
    t.edit(BLANK_SCENE);
    expect(t.repo.writeCalls).toHaveLength(0);
    await t.coordinator.flush();
    expect(t.repo.writeCalls).toHaveLength(1);
  });

  it("idle debounce fires without an explicit flush", async () => {
    const t = setup({ idleMs: 20, maxWaitMs: 500 });
    t.edit(BLANK_SCENE);
    await sleep(120);
    expect(t.repo.writeCalls).toHaveLength(1);
  });

  it("max-wait forces a write during continuous editing", async () => {
    const t = setup({ idleMs: 500, maxWaitMs: 40 });
    t.edit(BLANK_SCENE);
    await sleep(160);
    expect(t.repo.writeCalls).toHaveLength(1);
  });

  it("an edit arriving during an in-flight write stays dirty, then writes newest", async () => {
    const t = setup({ latencyMs: 60 });
    const latest = editedSampleScene();
    t.edit(BLANK_SCENE);
    const flushed = t.coordinator.flush();
    // Edit lands while the first write is in flight.
    await sleep(10);
    t.edit(latest);
    await flushed;
    expect(t.repo.writeCalls).toHaveLength(2);
    const disk = await t.repo.readDrawing(t.repo.handle, PATH);
    expect(disk.json).toBe(latest);
    expect(t.statuses[t.statuses.length - 1]).toBe("saved");
  });
});

describe("flush failures", () => {
  it("flush rejects when the backend write fails and reports error status", async () => {
    const t = setup();
    t.repo.failWrites = true;
    t.edit(BLANK_SCENE);
    await expect(t.coordinator.flush()).rejects.toThrow();
    expect(t.statuses).toContain("error");
    expect(t.errors).toHaveLength(1);
  });

  it("the coordinator remains usable after a failure (retry succeeds)", async () => {
    const t = setup();
    t.repo.failWrites = true;
    t.edit(BLANK_SCENE);
    await expect(t.coordinator.flush()).rejects.toThrow();
    t.repo.failWrites = false;
    t.edit(editedSampleScene());
    await t.coordinator.flush();
    const disk = await t.repo.readDrawing(t.repo.handle, PATH);
    expect(disk.json).toBe(editedSampleScene());
  });

  it("flush on an idle coordinator resolves immediately with no writes", async () => {
    const t = setup();
    await t.coordinator.flush();
    expect(t.repo.writeCalls).toHaveLength(0);
  });

  it("stop() rejects pending flush waiters and disables further scheduling", async () => {
    const t = setup({ latencyMs: 80 });
    t.edit(BLANK_SCENE);
    const flushed = t.coordinator.flush();
    const failure = new Error("Document changed");
    t.coordinator.stop(failure);
    await expect(flushed).rejects.toBe(failure);
    t.edit(editedSampleScene());
    await expect(t.coordinator.flush()).rejects.toBe(failure); // disposed: rejects with stop reason without writing
    expect(t.repo.writeCalls).toHaveLength(0);
  });
});
