import { describe, expect, it } from "vitest";

import { linkTargetFor, shapeLinkValue, wikiLink } from "./format";
import { createResolver, joinRelative, relativePath } from "./resolve";

const PATHS = [
  "Café.excalidraw",
  "Graphs/BFS and DFS.excalidraw",
  "Graphs/Dijkstra.excalidraw",
  "Work/Notes.excalidraw",
  "School/Notes.excalidraw",
  "School/Deep/Notes.excalidraw",
  "Work/x.excalidraw",
];
const r = createResolver(PATHS);

describe("resolver", () => {
  it("resolves exact paths, ignoring case and accents", () => {
    expect(r.resolve("", "[[graphs/dijkstra]]").path).toBe(
      "Graphs/Dijkstra.excalidraw",
    );
    expect(r.resolve("", "cafe").path).toBe("Café.excalidraw");
  });
  it("resolves a unique basename and partial paths", () => {
    expect(r.resolve("", "Dijkstra").path).toBe("Graphs/Dijkstra.excalidraw");
    expect(r.resolve("", "Deep/Notes").path).toBe(
      "School/Deep/Notes.excalidraw",
    );
  });
  it("picks the shortest of ambiguous matches and lists candidates", () => {
    const res = r.resolve("", "Notes");
    expect(res.path).toBe("Work/Notes.excalidraw");
    expect(res.candidates).toEqual([
      "Work/Notes.excalidraw",
      "School/Notes.excalidraw",
      "School/Deep/Notes.excalidraw",
    ]);
  });
  it("resolves relative forms from the source folder", () => {
    expect(r.resolve("Work/a.excalidraw", "./Notes.excalidraw").path).toBe(
      "Work/Notes.excalidraw",
    );
    expect(r.resolve("School/a.excalidraw", "[[./Notes]]").path).toBe(
      "School/Notes.excalidraw",
    );
    expect(
      r.resolve("School/Deep/a.excalidraw", "../Notes.excalidraw").path,
    ).toBe("School/Notes.excalidraw");
    expect(r.resolve("a.excalidraw", "./nothing").path).toBeNull();
    expect(r.resolve("School/a.excalidraw", "Notes.excalidraw").path).toBe(
      "School/Notes.excalidraw",
    );
  });
  it("resolves vaultdraw urls and rejects web links", () => {
    expect(
      r.resolve("", "vaultdraw://open?file=Graphs/BFS%20and%20DFS").path,
    ).toBe("Graphs/BFS and DFS.excalidraw");
    expect(r.resolve("", "https://example.com").path).toBeNull();
    expect(r.resolve("", "[[missing]]")).toEqual({
      path: null,
      candidates: [],
    });
  });
  it("joins and relativises paths", () => {
    expect(joinRelative("a/b", "../c")).toBe("a/c");
    expect(joinRelative("", "../c")).toBeNull();
    expect(relativePath("School/a.excalidraw", "Work/x.excalidraw")).toBe(
      "../Work/x.excalidraw",
    );
    expect(relativePath("Work/a.excalidraw", "Work/x.excalidraw")).toBe(
      "x.excalidraw",
    );
  });
});

describe("format", () => {
  it("shortest: bare name, then fewest folders, then full path", () => {
    expect(
      linkTargetFor(
        "Graphs/Dijkstra.excalidraw",
        "a.excalidraw",
        r,
        "shortest",
      ),
    ).toBe("Dijkstra");
    expect(linkTargetFor("School/Notes.excalidraw", null, r, "shortest")).toBe(
      "School/Notes",
    );
    expect(
      linkTargetFor("School/Deep/Notes.excalidraw", null, r, "shortest"),
    ).toBe("Deep/Notes");
    expect(linkTargetFor("Work/Notes.excalidraw", null, r, "shortest")).toBe(
      "Work/Notes",
    );
  });
  it("relative and absolute", () => {
    expect(
      linkTargetFor("Work/x.excalidraw", "School/a.excalidraw", r, "relative"),
    ).toBe("../Work/x");
    expect(
      linkTargetFor("Work/x.excalidraw", "Work/a.excalidraw", r, "relative"),
    ).toBe("./x");
    expect(
      linkTargetFor("Work/x.excalidraw", "a.excalidraw", r, "absolute"),
    ).toBe("Work/x");
  });
  it("written targets resolve back to the drawing", () => {
    for (const format of ["shortest", "relative", "absolute"] as const) {
      for (const from of ["a.excalidraw", "School/Deep/b.excalidraw"]) {
        for (const p of PATHS) {
          const t = linkTargetFor(p, from, r, format);
          expect(r.resolve(from, wikiLink(t)).path).toBe(p);
        }
      }
    }
  });
  it("shape link values", () => {
    expect(shapeLinkValue("A/B c", "wikilink")).toBe("[[A/B c]]");
    expect(shapeLinkValue("A/B c", "vaultdraw-url")).toBe(
      "vaultdraw://open?file=A/B%20c",
    );
    expect(wikiLink("a", "b")).toBe("[[a|b]]");
  });
});
