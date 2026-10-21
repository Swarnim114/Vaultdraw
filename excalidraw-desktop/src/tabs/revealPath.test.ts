import { describe, expect, it } from "vitest";

import { ancestorFolders } from "./revealPath";

describe("ancestorFolders", () => {
  it("lists every parent folder from the top", () => {
    expect(ancestorFolders("a/b/c.excalidraw")).toEqual(["a", "a/b"]);
  });
  it("a root drawing has none", () => {
    expect(ancestorFolders("c.excalidraw")).toEqual([]);
  });
});
