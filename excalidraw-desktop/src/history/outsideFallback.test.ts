import { describe, expect, it, vi } from "vitest";

import { createOutsideFallback, sha256Hex } from "./outsideFallback";

import type { HistoryRepository } from "./types";

const makeRepo = (staging: boolean, state = "idle") => {
  const snapshotBytes = vi.fn(async () => ({ id: "v", skipped: null }));
  const status = vi.fn(async () => ({ staging, state }));
  return {
    repo: { status, snapshotBytes } as unknown as HistoryRepository,
    snapshotBytes,
    status,
  };
};
const flushAsync = () => new Promise((r) => setTimeout(r, 0));

describe("outsideFallback", () => {
  it("sha256Hex matches the known digest", async () => {
    expect(await sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("staging true: outside change sends nothing", async () => {
    const { repo, snapshotBytes } = makeRepo(true);
    createOutsideFallback(() => repo).beforeOutsideChange("h", "a", "r", "j");
    await flushAsync();
    expect(snapshotBytes).not.toHaveBeenCalled();
  });

  it("staging false: sends the saved bytes with the saved revision", async () => {
    const { repo, snapshotBytes, status } = makeRepo(false);
    const fb = createOutsideFallback(() => repo);
    fb.beforeOutsideChange("h", "a.excalidraw", "rev1", "saved");
    fb.beforeOutsideChange("h", "a.excalidraw", "rev2", "saved2");
    await flushAsync();
    expect(snapshotBytes).toHaveBeenCalledWith(
      "h",
      "a.excalidraw",
      "before-outside-change",
      "rev1",
      "saved",
    );
    expect(snapshotBytes).toHaveBeenCalledTimes(2);
    expect(status).toHaveBeenCalledTimes(1); // cached per handle
  });

  it("history off: nothing is sent", async () => {
    const { repo, snapshotBytes } = makeRepo(false, "off");
    const fb = createOutsideFallback(() => repo);
    fb.beforeOutsideChange("h", "a", "r", "j");
    await fb.beforeDiscard("h", "a", "j");
    expect(snapshotBytes).not.toHaveBeenCalled();
  });

  it("outside change swallows errors", async () => {
    const { repo, snapshotBytes } = makeRepo(false);
    snapshotBytes.mockRejectedValue(new Error("boom"));
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
    const fb = createOutsideFallback(() => repo);
    fb.beforeOutsideChange("h", "a", "r", "j");
    fb.beforeOutsideChange("h", "a", "r", "j");
    await flushAsync();
    expect(debug).toHaveBeenCalledTimes(1);
    debug.mockRestore();
  });

  it("discarded-edits: sends sha256 of the bytes, even with staging", async () => {
    const { repo, snapshotBytes } = makeRepo(true);
    await createOutsideFallback(() => repo).beforeDiscard("h", "a", "abc");
    expect(snapshotBytes).toHaveBeenCalledWith(
      "h",
      "a",
      "discarded-edits",
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
      "abc",
    );
  });

  it("discarded-edits: resolves after the timeout when Rust hangs", async () => {
    const { repo, snapshotBytes } = makeRepo(true);
    snapshotBytes.mockImplementation(() => new Promise(() => {}));
    const t0 = Date.now();
    await createOutsideFallback(() => repo, 50).beforeDiscard("h", "a", "x");
    expect(Date.now() - t0).toBeLessThan(250);
  });

  it("discarded-edits: swallows errors", async () => {
    const { repo, snapshotBytes } = makeRepo(true);
    snapshotBytes.mockRejectedValue(new Error("boom"));
    vi.spyOn(console, "debug").mockImplementation(() => {});
    await expect(
      createOutsideFallback(() => repo).beforeDiscard("h", "a", "x"),
    ).resolves.toBeUndefined();
  });

  it("no repository: no-op", async () => {
    const fb = createOutsideFallback(() => undefined);
    fb.beforeOutsideChange("h", "a", "r", "j");
    await expect(fb.beforeDiscard("h", "a", "j")).resolves.toBeUndefined();
  });
});
