import { describe, expect, it } from "vitest";

import { resolveOpenTarget } from "./openTarget";

const has = (p: string) => p === "Graphs/BFS.excalidraw";
const r = (t: string, cwd = "/") => resolveOpenTarget(t, cwd, "/v", has);

describe("resolveOpenTarget", () => {
  it("handles links, absolute and cwd-relative paths", () => {
    expect(r("vaultdraw://open?file=Graphs/BFS")).toBe("Graphs/BFS.excalidraw");
    expect(r("/v/Graphs/BFS.excalidraw")).toBe("Graphs/BFS.excalidraw");
    expect(r("BFS", "/v/Graphs")).toBe("Graphs/BFS.excalidraw");
  });
  it("rejects outside the vault or missing", () => {
    expect(r("/other/BFS.excalidraw")).toBeNull();
    expect(r("/v/../x/BFS")).toBeNull();
    expect(r("/v/Nope")).toBeNull();
  });
});
