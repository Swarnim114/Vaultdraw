import { describe, expect, it } from "vitest";

import {
  encodeReloadMarker,
  parseReloadMarker,
  RELOAD_MARKER_KEY,
  takeReloadMarker,
  writableProblems,
} from "./reloadSmoke";

describe("reload marker", () => {
  it("round-trips a fresh marker", () => {
    expect(parseReloadMarker(encodeReloadMarker(1000, 7), 2000)).toEqual({
      v: 1,
      at: 1000,
      stepsBefore: 7,
    });
  });
  it("ignores missing, malformed, wrong-version, future and expired markers", () => {
    expect(parseReloadMarker(null, 0)).toBeNull();
    expect(parseReloadMarker("{", 0)).toBeNull();
    expect(parseReloadMarker('{"v":2,"at":1,"stepsBefore":1}', 2)).toBeNull();
    expect(parseReloadMarker(encodeReloadMarker(5000, 1), 1000)).toBeNull();
    expect(parseReloadMarker(encodeReloadMarker(0, 1), 10 ** 7)).toBeNull();
  });
  it("is one-shot: taking it removes it, so a second launch does not resume", () => {
    const data = new Map([[RELOAD_MARKER_KEY, encodeReloadMarker(100, 3)]]);
    const storage = {
      getItem: (k: string) => data.get(k) ?? null,
      removeItem: (k: string) => void data.delete(k),
    };
    expect(takeReloadMarker(storage, 200)?.stepsBefore).toBe(3);
    expect(takeReloadMarker(storage, 200)).toBeNull();
  });
  it("never throws on broken storage", () => {
    const storage = {
      getItem: () => {
        throw new Error("denied");
      },
      removeItem: () => {},
    };
    expect(takeReloadMarker(storage, 0)).toBeNull();
  });
});

describe("writableProblems", () => {
  it("is empty for a writable vault", () => {
    expect(writableProblems({ readOnly: false, readOnlyReason: null })).toEqual(
      [],
    );
  });
  it("names the old behaviour: read-only because the lock is held", () => {
    expect(
      writableProblems({
        readOnly: true,
        readOnlyReason: "lockedByOtherProcess",
      }),
    ).toEqual([
      "VaultInfo.readOnly is true",
      "readOnlyReason is lockedByOtherProcess",
    ]);
  });
  it("fails when nothing opened", () => {
    expect(writableProblems(null)).toHaveLength(1);
  });
});
