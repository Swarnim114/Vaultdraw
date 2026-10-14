import { describe, expect, it } from "vitest";

import { FakeVaultRepository } from "../tests/fakeVaultRepository";
import { FakeVaultSearch } from "../tests/fakeVaultSearch";

const scene = (...texts: string[]) =>
  JSON.stringify({
    type: "excalidraw",
    elements: texts.map((text, i) => ({
      id: `e${i}`,
      type: "text",
      text,
      isDeleted: false,
    })),
  });

async function setup() {
  const repo = new FakeVaultRepository();
  repo.seedDrawing("a.excalidraw", scene("#DSA/Graphs bfs", "plain"));
  repo.seedDrawing(
    "sub/b.excalidraw",
    scene("#dsa notes", "#dsa/graphs dijkstra"),
  );
  repo.seedDrawing("c.excalidraw", scene("#todo graph", "no tags"));
  repo.seedDrawing("d.excalidraw", scene("nothing here"));
  const search = new FakeVaultSearch(repo);
  const h = repo.vault.handle;
  return {
    tags: () => search.tags(h),
    paths: async (q: string) =>
      (await search.search(h, q)).results.map((r) => r.path).sort(),
    run: (q: string) => search.search(h, q),
  };
}

describe("FakeVaultSearch tags", () => {
  it("counts drawings per tag including ancestors, min display wins", async () => {
    const { tags } = await setup();
    const res = await tags();
    expect(res.tags).toEqual([
      { tag: "dsa", display: "DSA", count: 2 },
      { tag: "dsa/graphs", display: "DSA/Graphs", count: 2 },
      { tag: "todo", display: "todo", count: 1 },
    ]);
    expect(res.byPath).toEqual({
      "a.excalidraw": ["DSA/Graphs"],
      "sub/b.excalidraw": ["dsa", "dsa/graphs"],
      "c.excalidraw": ["todo"],
    });
    expect(res.status.state).toBe("ready");
  });

  it("tag filter matches parent and children, tag-only lists tagged lines", async () => {
    const { paths, run } = await setup();
    expect(await paths("tag:#dsa")).toEqual([
      "a.excalidraw",
      "sub/b.excalidraw",
    ]);
    expect(await paths("tag:#DSA/graphs")).toEqual([
      "a.excalidraw",
      "sub/b.excalidraw",
    ]);
    expect(await paths("tag:#ds")).toEqual([]);
    const hit = (await run("tag:#todo")).results[0];
    expect(hit.matches.map((m) => m.snippet)).toEqual(["#todo graph"]);
    expect(hit.matches[0].highlights).toEqual([[0, 5]]);
  });

  it("combines with text and multiple filters ANDs", async () => {
    const { paths } = await setup();
    expect(await paths("graph tag:#dsa")).toEqual([
      "a.excalidraw",
      "sub/b.excalidraw",
    ]);
    expect(await paths("dijkstra tag:#dsa")).toEqual(["sub/b.excalidraw"]);
    expect(await paths("graph tag:#todo")).toEqual(["c.excalidraw"]);
    expect(await paths("tag:#dsa tag:#todo")).toEqual([]);
  });
});
