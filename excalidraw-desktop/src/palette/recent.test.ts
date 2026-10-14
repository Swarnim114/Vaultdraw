import { afterEach, describe, expect, it } from "vitest";

import { getRecent, recordRecent } from "./recent";

const KEY = "vaultdraw.palette.recent.v1";

afterEach(() => localStorage.clear());

describe("recent", () => {
  it("records most recent first without duplicates and persists", () => {
    recordRecent("a", window);
    recordRecent("b", window);
    recordRecent("a", window);
    expect(getRecent(window)).toEqual(["a", "b"]);
    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual(["a", "b"]);
  });

  it("keeps at most 30", () => {
    for (let i = 0; i < 40; i++) {
      recordRecent(`k${i}`, window);
    }
    const list = getRecent(window);
    expect(list).toHaveLength(30);
    expect(list[0]).toBe("k39");
  });

  it("survives corrupt storage and a failing setItem", () => {
    localStorage.setItem(KEY, "{nope");
    expect(Array.isArray(getRecent(window))).toBe(true);
    const win = {
      localStorage: {
        getItem: () => {
          throw new Error("blocked");
        },
        setItem: () => {
          throw new Error("quota");
        },
      },
    } as unknown as Window;
    recordRecent("x", win);
    expect(getRecent(win)).toEqual(["x"]);
  });

  it("ignores non-string entries", () => {
    localStorage.setItem(KEY, JSON.stringify(["a", 3, null, "b"]));
    expect(getRecent(window)).toEqual(["a", "b"]);
  });
});
