import { describe, expect, it, vi } from "vitest";

import { act, renderHook } from "@testing-library/react";

import { FakeVaultRepository } from "../tests/fakeVaultRepository";

import { SaveCoordinator } from "./saveCoordinator";
import { useVaultDocument } from "./useVaultDocument";

import type { VaultRepository } from "./types";

const repo = (writeDrawing: VaultRepository["writeDrawing"]) =>
  ({ writeDrawing } as VaultRepository);
const target = () => ({
  handle: "h",
  path: "a.excalidraw",
  documentId: "d",
  revision: "r1",
});

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

describe("SaveCoordinator hardening", () => {
  it("does not busy-retry failed writes; explicit flush retries", async () => {
    const write = vi
      .fn()
      .mockRejectedValueOnce(new Error("disk full"))
      .mockResolvedValue({ revision: "r2" });
    const statuses: string[] = [];
    const coordinator = new SaveCoordinator({
      repository: repo(write),
      target,
      snapshot: () => "scene",
      onStatus: (status) => statuses.push(status),
      onSaved: () => {},
      idleMs: 5,
    });
    coordinator.schedule();
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(write).toHaveBeenCalledTimes(1);
    expect(statuses).toContain("error");
    await coordinator.flush();
    expect(write).toHaveBeenCalledTimes(2);
  });

  it("maps conflict errors to conflict and rejects flush after stop", async () => {
    const write = vi
      .fn()
      .mockRejectedValue({ code: "CONFLICT", message: "revision changed" });
    const statuses: string[] = [];
    const coordinator = new SaveCoordinator({
      repository: repo(write),
      target,
      snapshot: () => "scene",
      onStatus: (status) => statuses.push(status),
      onSaved: () => {},
    });
    coordinator.schedule();
    await expect(coordinator.flush()).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect(statuses).toContain("conflict");
    await coordinator.stop(new Error("conflicted"));
    await expect(coordinator.flush()).rejects.toThrow("conflicted");
  });

  it("keeps dirty edits saveable when reload read fails", async () => {
    const repository = new FakeVaultRepository();
    vi.spyOn(repository, "subscribe").mockResolvedValue(() => {});
    repository.seedDrawing("a.excalidraw", "initial");
    const { result } = renderHook(() =>
      useVaultDocument(repository, repository.vault),
    );
    await act(async () => result.current.open("a.excalidraw"));
    act(() => result.current.change("dirty latest"));
    vi.spyOn(repository, "readDrawing").mockRejectedValueOnce(
      new Error("corrupt drawing"),
    );
    await expect(result.current.reload()).rejects.toThrow("corrupt drawing");
    await act(async () => result.current.flush());
    expect(
      (await repository.readDrawing(repository.handle, "a.excalidraw")).json,
    ).toBe("dirty latest");
  });

  it("keeps the active save path after a save-copy destination collision", async () => {
    const repository = new FakeVaultRepository();
    vi.spyOn(repository, "subscribe").mockResolvedValue(() => {});
    repository.seedDrawing("a.excalidraw", "initial");
    repository.seedDrawing("already-there.excalidraw", "untouched");
    const { result } = renderHook(() =>
      useVaultDocument(repository, repository.vault),
    );
    await act(async () => result.current.open("a.excalidraw"));
    act(() => result.current.change("dirty latest"));
    await expect(
      act(async () => result.current.saveCopy("already-there.excalidraw")),
    ).rejects.toThrow(/already exists/i);
    expect(result.current.document?.path).toBe("a.excalidraw");
    await act(async () => result.current.flush());
    expect(
      (await repository.readDrawing(repository.handle, "a.excalidraw")).json,
    ).toBe("dirty latest");
    expect(
      (
        await repository.readDrawing(
          repository.handle,
          "already-there.excalidraw",
        )
      ).json,
    ).toBe("untouched");
  });

  it("waits for an active write and suppresses its stale acknowledgement", async () => {
    const pending = deferred<{ revision: string }>();
    const onSaved = vi.fn();
    const coordinator = new SaveCoordinator({
      repository: repo(vi.fn(() => pending.promise)),
      target,
      snapshot: () => "scene",
      onStatus: () => {},
      onSaved,
    });
    coordinator.schedule();
    const stop = coordinator.stop();
    let settled = false;
    void stop.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    pending.resolve({ revision: "r2" });
    await stop;
    expect(onSaved).not.toHaveBeenCalled();
  });
});
