import { describe, expect, it } from "vitest";

import { FakeVaultLinks } from "./fakeVaultLinks";
import { FakeVaultRepository } from "./fakeVaultRepository";

import type { RewriteDone } from "../links/types";

type El = Record<string, unknown>;
const text = (id: string, t: string, extra: El = {}): El => ({
  id,
  type: "text",
  text: t,
  originalText: t,
  version: 1,
  ...extra,
});
const scene = (...elements: El[]) =>
  JSON.stringify({
    type: "excalidraw",
    version: 2,
    elements,
    appState: {},
    files: {},
  });

function setup() {
  const repo = new FakeVaultRepository();
  const links = new FakeVaultLinks(repo);
  repo.seedDrawing("Notes.excalidraw", scene(text("n1", "plain")));
  repo.seedDrawing(
    "Graphs/BFS.excalidraw",
    scene(
      text("a", "see [[Notes]] and [[Missing|nope]]"),
      { id: "box", type: "rectangle", link: "[[Notes]]", version: 1 },
      text("lbl", "Box label", { containerId: "box" }),
      { id: "web", type: "rectangle", link: "https://example.com", version: 1 },
      text("gone", "[[Notes]]", { isDeleted: true }),
    ),
  );
  repo.seedDrawing(
    "Work/Plan.excalidraw",
    scene(
      text("p", "line one\nlink: [[Graphs/BFS|bfs]] and [[Notes]]\nthree"),
      text("m", "I mention notes without a link"),
    ),
  );
  return { repo, links, h: repo.handle };
}

const read = async (repo: FakeVaultRepository, path: string) =>
  JSON.parse((await repo.readDrawing(repo.handle, path)).json).elements as El[];

describe("FakeVaultLinks queries", () => {
  it("lists outgoing, unresolved and backlinks with snippets", async () => {
    const { links, h } = setup();
    const bfs = await links.links(h, "Graphs/BFS.excalidraw");
    expect(bfs.outgoing.map((l) => [l.elementId, l.kind, l.resolved])).toEqual([
      ["a", "text", "Notes.excalidraw"],
      ["box", "shape", "Notes.excalidraw"],
    ]);
    expect(bfs.unresolved).toMatchObject([
      { target: "Missing", label: "nope" },
    ]);
    expect(bfs.backlinks).toEqual([
      {
        path: "Work/Plan.excalidraw",
        elementId: "p",
        containerId: null,
        kind: "text",
        snippet: "link: [[Graphs/BFS|bfs]] and [[Notes]]",
        highlights: [[6, 24]],
      },
    ]);

    const notes = await links.links(h, "Notes.excalidraw");
    expect(
      notes.backlinks.map((b) => [b.path, b.elementId, b.kind, b.snippet]),
    ).toEqual([
      [
        "Graphs/BFS.excalidraw",
        "a",
        "text",
        "see [[Notes]] and [[Missing|nope]]",
      ],
      ["Graphs/BFS.excalidraw", "box", "shape", "Box label"],
      [
        "Work/Plan.excalidraw",
        "p",
        "text",
        "link: [[Graphs/BFS|bfs]] and [[Notes]]",
      ],
    ]);
  });

  it("finds unlinked mentions only when asked", async () => {
    const { links, h } = setup();
    expect(links.calls.unlinkedMentions).toBe(0);
    const res = await links.unlinkedMentions(h, "Notes.excalidraw");
    expect(res.mentions).toMatchObject([
      {
        path: "Work/Plan.excalidraw",
        elementId: "m",
        kind: "text",
        highlights: [[10, 15]],
      },
    ]);
    expect(
      (await links.unlinkedMentions(h, "Notes.excalidraw", 0)).mentions,
    ).toEqual([]);
  });

  it("resolves raw links", async () => {
    const { links, h } = setup();
    expect(await links.resolve(h, "a.excalidraw", "[[bfs]]")).toEqual({
      path: "Graphs/BFS.excalidraw",
      candidates: [],
    });
  });
});

describe("FakeVaultLinks moves", () => {
  async function renameNotes(openPath: string | null, rewrite = true) {
    const ctx = setup();
    const done: RewriteDone[] = [];
    await ctx.links.onRewriteDone((d) => done.push(d));
    const res = await ctx.links.moveWithLinks(
      ctx.h,
      "Notes.excalidraw",
      "Notes renamed.excalidraw",
      openPath,
      rewrite,
    );
    return { ...ctx, res, done };
  }

  it("rewrites closed drawings in the background and reports it", async () => {
    const { repo, links, res, done } = await renameNotes(null);
    expect(res).toMatchObject({
      plannedFiles: 2,
      plannedLinks: 3,
      openDrawingEdits: [],
    });
    expect(res.jobId).toBe(1);
    expect(done).toEqual([]); // asynchronous
    await links.settled();
    expect(done).toHaveLength(1);
    expect(done[0]).toMatchObject({
      jobId: 1,
      rewritten: 2,
      links: 3,
      failed: [],
    });
    const bfs = await read(repo, "Graphs/BFS.excalidraw");
    const a = bfs.find((e) => e.id === "a")!;
    expect(a.text).toBe("see [[Notes renamed]] and [[Missing|nope]]");
    expect(a.originalText).toBe(a.text);
    expect(a.version).toBe(2);
    expect(bfs.find((e) => e.id === "box")!.link).toBe("[[Notes renamed]]");
    expect(bfs.find((e) => e.id === "gone")!.text).toBe("[[Notes]]");
    const plan = await read(repo, "Work/Plan.excalidraw");
    expect(plan.find((e) => e.id === "p")!.text).toBe(
      "line one\nlink: [[Graphs/BFS|bfs]] and [[Notes renamed]]\nthree",
    );
    expect((await links.remeasure()).paths).toEqual({
      "Graphs/BFS.excalidraw": ["a"],
      "Work/Plan.excalidraw": ["p"],
    });
    await links.remeasureDone(repo.handle, "Work/Plan.excalidraw");
    expect(Object.keys((await links.remeasure()).paths)).toEqual([
      "Graphs/BFS.excalidraw",
    ]);
    expect(
      (await links.links(repo.handle, "Notes renamed.excalidraw")).backlinks,
    ).toHaveLength(3);
  });

  it("returns the open drawing's edits and never writes that file", async () => {
    const { repo, links, res } = await renameNotes("Graphs/BFS.excalidraw");
    expect(res.plannedFiles).toBe(1);
    expect(res.openDrawingEdits).toEqual([
      {
        elementId: "a",
        field: "text",
        value: "see [[Notes renamed]] and [[Missing|nope]]",
      },
      { elementId: "box", field: "link", value: "[[Notes renamed]]" },
    ]);
    await links.settled();
    const a = (await read(repo, "Graphs/BFS.excalidraw")).find(
      (e) => e.id === "a",
    )!;
    expect(a.text).toBe("see [[Notes]] and [[Missing|nope]]");
    expect(repo.writeCalls.map((c) => c.path)).toEqual([
      "Work/Plan.excalidraw",
    ]);
  });

  it("honours rewrite=false (plain move)", async () => {
    const { repo, res, done, links } = await renameNotes(null, false);
    expect(res).toEqual({
      jobId: null,
      plannedFiles: 0,
      plannedLinks: 0,
      openDrawingEdits: [],
    });
    await links.settled();
    expect(done).toEqual([]);
    expect(repo.writeCalls).toEqual([]);
    expect(
      await repo.readDrawing(repo.handle, "Notes renamed.excalidraw"),
    ).toBeTruthy();
  });

  it("needs no rewrite when a unique basename merely changes folder", async () => {
    const { repo, links, h } = setup();
    repo.seedFolder("Archive");
    const res = await links.moveWithLinks(
      h,
      "Notes.excalidraw",
      "Archive/Notes.excalidraw",
      null,
      true,
    );
    expect(res).toMatchObject({
      jobId: null,
      plannedFiles: 0,
      plannedLinks: 0,
    });
    expect(
      (await links.links(h, "Archive/Notes.excalidraw")).backlinks,
    ).toHaveLength(3);
  });

  it("follows relative links when the source folder moves", async () => {
    const { repo, links, h } = setup();
    repo.seedDrawing(
      "Work/Other.excalidraw",
      scene(text("o", "up: [[../Notes]]")),
    );
    repo.seedFolder("Deep/Er");
    await links.moveWithLinks(h, "Work", "Deep/Er/Work", null, true);
    await links.settled();
    const o = (await read(repo, "Deep/Er/Work/Other.excalidraw"))[0];
    expect(o.text).toBe("up: [[../../../Notes]]");
  });

  it("reports links that would silently re-point", async () => {
    const repo = new FakeVaultRepository();
    const links = new FakeVaultLinks(repo);
    repo.seedDrawing("Work/Notes.excalidraw", scene(text("w", "work")));
    repo.seedDrawing("School/Notes.excalidraw", scene(text("s", "school")));
    repo.seedDrawing("Ref.excalidraw", scene(text("r", "see [[Notes]]")));
    // [[Notes]] resolves to the shortest path, Work/Notes. A root "Notes"
    // would win by exact path: the move silently re-points the link.
    const plan = await links.planMove(
      repo.handle,
      "School/Notes.excalidraw",
      "Notes.excalidraw",
    );
    expect(plan).toEqual({
      files: 0,
      links: 0,
      rePointed: [
        {
          path: "Ref.excalidraw",
          target: "Notes",
          from: "Work/Notes.excalidraw",
          to: "Notes.excalidraw",
        },
      ],
    });
    const harmless = await links.planMove(
      repo.handle,
      "School/Notes.excalidraw",
      "Elsewhere/Notes.excalidraw",
    );
    expect(harmless.rePointed).toEqual([]);
  });

  it("skips a changed file instead of overwriting it", async () => {
    const { repo, links, h } = setup();
    const done: RewriteDone[] = [];
    await links.onRewriteDone((d) => done.push(d));
    await links.moveWithLinks(
      h,
      "Notes.excalidraw",
      "N2.excalidraw",
      null,
      true,
    );
    repo.externalWrite(
      "Work/Plan.excalidraw",
      scene(text("p", "[[N2]] edited by hand")),
    );
    await links.settled();
    expect(done[0].rewritten + done[0].failed.length).toBe(2);
    const plan = await read(repo, "Work/Plan.excalidraw");
    expect(plan[0].text).toBe("[[N2]] edited by hand");
  });
});
