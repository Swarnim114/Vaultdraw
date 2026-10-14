import { afterEach, describe, expect, it } from "vitest";

import { getRecent, recordRecent } from "./recent";

const COMMANDS_KEY = "vaultdraw.palette.recent.commands.v1";
const FILES_KEY = "vaultdraw.palette.recent.files.v1";
const LEGACY_KEY = "vaultdraw.palette.recent.v1";

afterEach(() => localStorage.clear());

describe("recent", () => {
  it("records most recent first without duplicates and persists", () => {
    recordRecent("a", window);
    recordRecent("b", window);
    recordRecent("a", window);
    expect(getRecent("commands", window)).toEqual(["a", "b"]);
    expect(JSON.parse(localStorage.getItem(COMMANDS_KEY)!)).toEqual(["a", "b"]);
  });

  it("keeps one list per mode", () => {
    recordRecent("drawing:x.excalidraw", window);
    recordRecent("command:file.save", window);
    recordRecent("drawing:y.excalidraw", window);
    expect(getRecent("files", window)).toEqual([
      "drawing:y.excalidraw",
      "drawing:x.excalidraw",
    ]);
    expect(getRecent("commands", window)).toEqual(["command:file.save"]);
    expect(JSON.parse(localStorage.getItem(FILES_KEY)!)).toHaveLength(2);
  });

  it("falls back to F41's mixed list, split by mode", () => {
    localStorage.setItem(
      LEGACY_KEY,
      JSON.stringify(["theme:Nord", "drawing:a.excalidraw", "command:x"]),
    );
    expect(getRecent("files", window)).toEqual(["drawing:a.excalidraw"]);
    expect(getRecent("commands", window)).toEqual(["theme:Nord", "command:x"]);
    recordRecent("command:y", window);
    expect(getRecent("commands", window)).toEqual([
      "command:y",
      "theme:Nord",
      "command:x",
    ]);
    // The files list is still derived from the legacy list.
    expect(getRecent("files", window)).toEqual(["drawing:a.excalidraw"]);
  });

  it("keeps at most 30", () => {
    for (let i = 0; i < 40; i++) {
      recordRecent(`k${i}`, window);
    }
    const list = getRecent("commands", window);
    expect(list).toHaveLength(30);
    expect(list[0]).toBe("k39");
  });

  it("survives corrupt storage and a failing setItem", () => {
    localStorage.setItem(COMMANDS_KEY, "{nope");
    expect(Array.isArray(getRecent("commands", window))).toBe(true);
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
    expect(getRecent("commands", win)).toEqual(["x"]);
    expect(getRecent("files", win)).toEqual([]);
  });

  it("ignores non-string entries", () => {
    localStorage.setItem(COMMANDS_KEY, JSON.stringify(["a", 3, null, "b"]));
    expect(getRecent("commands", window)).toEqual(["a", "b"]);
  });
});
