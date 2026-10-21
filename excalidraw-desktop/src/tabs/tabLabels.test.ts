import { describe, expect, it } from "vitest";

import { tabLabels, tabName } from "./tabLabels";

const t = (path: string | null) => ({ path });

describe("tabName", () => {
  it("strips folders and the .excalidraw extension", () => {
    expect(tabName("DP/Intro.excalidraw")).toBe("Intro");
    expect(tabName("Intro.EXCALIDRAW")).toBe("Intro");
    expect(tabName("a/b/notes.v2.excalidraw")).toBe("notes.v2");
  });
  it("labels the home tab", () => {
    expect(tabName(null)).toBe("New tab");
  });
});

describe("tabLabels", () => {
  it("leaves unique names alone", () => {
    expect(
      tabLabels([t("a.excalidraw"), t("x/b.excalidraw"), t(null)]),
    ).toEqual(["a", "b", "New tab"]);
  });
  it("adds the parent folder to duplicates", () => {
    expect(
      tabLabels([t("DP/Intro.excalidraw"), t("OS/Intro.excalidraw")]),
    ).toEqual(["Intro · DP/", "Intro · OS/"]);
  });
  it("gives a root-level duplicate no suffix", () => {
    expect(
      tabLabels([t("Intro.excalidraw"), t("DP/Intro.excalidraw")]),
    ).toEqual(["Intro", "Intro · DP/"]);
  });
  it("uses more parents when the parent folder name collides", () => {
    expect(
      tabLabels([t("a/x/Intro.excalidraw"), t("b/x/Intro.excalidraw")]),
    ).toEqual(["Intro · a/x/", "Intro · b/x/"]);
  });
  it("never suffixes home tabs", () => {
    expect(tabLabels([t(null), t(null)])).toEqual(["New tab", "New tab"]);
  });
});
