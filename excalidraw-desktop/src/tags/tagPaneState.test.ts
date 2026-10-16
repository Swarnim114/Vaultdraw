import { beforeEach, describe, expect, it, vi } from "vitest";

import { loadPaneState, savePaneState } from "./tagPaneState";

beforeEach(() => window.localStorage.clear());

describe("tag pane state", () => {
  it("round-trips per vault and merges patches", () => {
    savePaneState("/v1", { sort: "count" });
    savePaneState("/v1", { collapsed: ["a"], open: false });
    savePaneState("/v2", { sort: "name" });
    expect(loadPaneState("/v1")).toEqual({
      sort: "count",
      open: false,
      collapsed: ["a"],
    });
    expect(loadPaneState("/v2").sort).toBe("name");
    expect(loadPaneState("/none")).toEqual({});
  });

  it("ignores corrupt data", () => {
    window.localStorage.setItem("vaultdraw.tagsPane.v1", "{nope");
    expect(loadPaneState("/v1")).toEqual({});
    window.localStorage.setItem(
      "vaultdraw.tagsPane.v1",
      JSON.stringify({ "/v1": { sort: "weird", collapsed: [1, "a"] } }),
    );
    expect(loadPaneState("/v1")).toEqual({
      sort: undefined,
      open: undefined,
      collapsed: ["a"],
    });
  });

  it("survives unavailable storage", () => {
    const spy = vi
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new Error("denied");
      });
    expect(loadPaneState("/v1")).toEqual({});
    expect(() => savePaneState("/v1", { sort: "name" })).not.toThrow();
    spy.mockRestore();
  });
});
