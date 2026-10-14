/**
 * FakeVaultSearch parity with the Rust contract (PLAN.md): AND semantics,
 * accent/case/width folding, CJK substring, UTF-16 highlight offsets, scopes,
 * limits and element metadata. Known divergences from Rust are `it.fails`.
 */
import { describe, expect, it } from "vitest";

import { FakeVaultRepository } from "./fakeVaultRepository";
import { FakeVaultSearch } from "./fakeVaultSearch";

import type { SearchResponse } from "../search/types";

type El = Record<string, unknown>;

const text = (id: string, t: string, extra: El = {}): El => ({
  id,
  type: "text",
  text: t,
  originalText: t,
  isDeleted: false,
  ...extra,
});

const scene = (elements: El[]) =>
  JSON.stringify({ type: "excalidraw", version: 2, elements, appState: {} });

async function setup(files: Record<string, El[] | string>) {
  const repo = new FakeVaultRepository();
  for (const [path, body] of Object.entries(files)) {
    repo.seedDrawing(path, typeof body === "string" ? body : scene(body));
  }
  const search = new FakeVaultSearch(repo);
  const run = (q: string, opts?: Parameters<FakeVaultSearch["search"]>[2]) =>
    search.search(repo.vault.handle, q, opts);
  const paths = async (q: string, opts?: Parameters<typeof run>[1]) =>
    (await run(q, opts)).results.map((h) => h.path);
  return { repo, search, run, paths };
}

const slice = (s: string, r: [number, number]) => s.slice(r[0], r[1]);
const first = (r: SearchResponse) => r.results[0].matches[0];

describe("FakeVaultSearch parity: matching", () => {
  it("ANDs terms across different elements and the file name", async () => {
    const { paths } = await setup({
      "both.excalidraw": [
        text("a", "dijkstra"),
        text("b", "unrelated"),
        text("c", "graph"),
      ],
      "one.excalidraw": [text("a", "dijkstra only")],
      "kruskal.excalidraw": [text("a", "mst")],
    });
    expect(await paths("dijkstra graph")).toEqual(["both.excalidraw"]);
    expect(await paths("graph   dijkstra")).toEqual(["both.excalidraw"]);
    expect(await paths("dijkstra graph nope")).toEqual([]);
    expect(await paths("kruskal mst")).toEqual(["kruskal.excalidraw"]);
  });

  it("is accent, case and width insensitive in both directions", async () => {
    const { paths } = await setup({
      "a.excalidraw": [text("a", "Café au lait ＡＢＣ１２３")],
      "b.excalidraw": [text("a", "naive resume")],
    });
    for (const q of ["cafe", "CAFÉ", "cafe au", "abc123", "ＡＢＣ"]) {
      expect(await paths(q), q).toEqual(["a.excalidraw"]);
    }
    expect(await paths("naïve résumé")).toEqual(["b.excalidraw"]);
    expect(await paths("Cafe\u0301")).toEqual(["a.excalidraw"]);
  });

  it("finds CJK and Hangul by substring and keeps voiced kana distinct", async () => {
    const { paths } = await setup({
      "zh.excalidraw": [text("a", "数据库设计与服务认证流程")],
      "ko.excalidraw": [text("a", "한국어 문서")],
      "ja.excalidraw": [text("a", "がっこう")],
    });
    expect(await paths("数据库")).toEqual(["zh.excalidraw"]);
    expect(await paths("库设计")).toEqual(["zh.excalidraw"]);
    expect(await paths("数据库 流程")).toEqual(["zh.excalidraw"]);
    expect(await paths("국어")).toEqual(["ko.excalidraw"]);
    expect(await paths("が")).toEqual(["ja.excalidraw"]);
  });

  it("does not crash on RTL text", async () => {
    const { paths } = await setup({
      "ar.excalidraw": [text("a", "مرحبا بالعالم")],
    });
    expect(await paths("مرحبا")).toEqual(["ar.excalidraw"]);
  });

  it("returns nothing for blank queries", async () => {
    const { paths } = await setup({ "a.excalidraw": [text("a", "x")] });
    for (const q of ["", "  ", "\n"]) {
      expect(await paths(q)).toEqual([]);
    }
  });

  it("indexes frames and bound labels with container ids, skipping deleted elements", async () => {
    const { run } = await setup({
      "a.excalidraw": [
        { id: "f", type: "frame", name: "Graph algorithms", isDeleted: false },
        { id: "mf", type: "magicframe", name: "Magic" },
        text("lbl", "Dijkstra", { containerId: "rect" }),
        text("ghost", "ghost", { isDeleted: true }),
        { id: "gf", type: "frame", name: "ghost frame", isDeleted: true },
        { id: "r", type: "rectangle", name: "not indexed" },
      ],
    });
    const frame = first(await run("graph alg"));
    expect([frame.elementId, frame.kind, frame.containerId]).toEqual([
      "f",
      "frame",
      null,
    ]);
    // each term is its own range ("graph" and "alg" are separated by a space)
    expect(frame.highlights.map((h) => slice(frame.snippet, h))).toEqual([
      "Graph",
      "alg",
    ]);
    const label = first(await run("dijk"));
    expect([label.elementId, label.containerId]).toEqual(["lbl", "rect"]);
    expect((await run("ghost")).results).toEqual([]);
    expect((await run("not indexed")).results).toEqual([]);
    expect(first(await run("magic")).kind).toBe("frame");
  });

  it("treats malformed JSON as name-only", async () => {
    const { paths } = await setup({
      "broken.excalidraw": "{ nope",
      "array.excalidraw": "[1,2]",
      "ok.excalidraw": [text("a", "broken words")],
    });
    expect(await paths("broken")).toEqual(
      ["broken.excalidraw", "ok.excalidraw"].sort(),
    );
    expect(await paths("array")).toEqual(["array.excalidraw"]);
  });
});

describe("FakeVaultSearch parity: highlights and snippets", () => {
  it("reports UTF-16 offsets that slice back to the matched text (emoji, case)", async () => {
    const { run } = await setup({
      "a.excalidraw": [text("a", "😀 Data 🎉 base 😀data")],
    });
    const m = first(await run("data"));
    expect(m.highlights[0]).toEqual([3, 7]);
    expect(m.highlights.map((h) => slice(m.snippet, h))).toEqual([
      "Data",
      "data",
    ]);
  });

  it("highlights every term, merges overlaps, keeps original casing", async () => {
    const { run } = await setup({
      "a.excalidraw": [text("a", "Dijkstra Shortest PATH")],
    });
    expect(
      first(await run("path dijk")).highlights.map((h) =>
        slice("Dijkstra Shortest PATH", h),
      ),
    ).toEqual(["Dijk", "PATH"]);
    expect(
      first(await run("dijk dijkstra")).highlights.map((h) =>
        slice("Dijkstra Shortest PATH", h),
      ),
    ).toEqual(["Dijkstra"]);
  });

  it("highlights fullwidth and decomposed accents using original offsets", async () => {
    const { run } = await setup({
      "a.excalidraw": [text("a", "ＡＢＣ Cafe\u0301 x")],
    });
    const m = first(await run("abc cafe"));
    expect(m.highlights.map((h) => slice(m.snippet, h))).toEqual([
      "ＡＢＣ",
      "Cafe",
    ]);
  });

  it("truncates long text with ellipses and keeps highlights valid", async () => {
    const long = `${"lorem ipsum ".repeat(20)}needle ${"dolor sit ".repeat(
      20,
    )}`;
    const { run } = await setup({ "a.excalidraw": [text("a", long)] });
    const m = first(await run("needle"));
    expect(m.snippet.startsWith("…")).toBe(true);
    expect(m.snippet.endsWith("…")).toBe(true);
    expect(m.snippet.length).toBeLessThanOrEqual(122);
    expect(slice(m.snippet, m.highlights[0])).toBe("needle");
  });

  it("only adds the trailing ellipsis when the match is at the start", async () => {
    const { run } = await setup({
      "a.excalidraw": [text("a", `needle ${"x ".repeat(200)}`)],
    });
    const m = first(await run("needle"));
    expect(m.snippet.startsWith("…")).toBe(false);
    expect(m.snippet.endsWith("…")).toBe(true);
    expect(m.highlights[0]).toEqual([0, 6]);
  });

  it("produces single-line snippets", async () => {
    const { run } = await setup({
      "a.excalidraw": [text("a", "first line\nsecond\n\nthird")],
    });
    const m = first(await run("second"));
    expect(m.snippet).not.toMatch(/\n/);
    expect(slice(m.snippet, m.highlights[0])).toBe("second");
  });

  it("highlights the file name stem region that matched", async () => {
    const { run } = await setup({
      "DSA/Shortest Paths.excalidraw": [text("a", "x")],
    });
    const h = (await run("short")).results[0];
    expect(h.name).toBe("Shortest Paths.excalidraw");
    expect(h.nameHighlights).toEqual([[0, 5]]);
  });
});

describe("FakeVaultSearch parity: scope, limit, counts", () => {
  it("scope names / content / all", async () => {
    const { run, paths } = await setup({
      "alpha.excalidraw": [text("a", "beta")],
      "gamma.excalidraw": [text("a", "alpha")],
    });
    expect(await paths("alpha", { scope: "names" })).toEqual([
      "alpha.excalidraw",
    ]);
    expect(await paths("alpha", { scope: "content" })).toEqual([
      "gamma.excalidraw",
    ]);
    expect((await paths("alpha")).sort()).toEqual([
      "alpha.excalidraw",
      "gamma.excalidraw",
    ]);
    const names = (await run("alpha", { scope: "names" })).results[0];
    expect(names.matches).toEqual([]);
    expect(names.nameHighlights).toEqual([[0, 5]]);
    const content = (await run("alpha", { scope: "content" })).results[0];
    expect(content.nameHighlights).toEqual([]);
    expect(await paths("beta", { scope: "names" })).toEqual([]);
  });

  it("limits results, caps at 200 and reports totalMatches", async () => {
    const files: Record<string, El[]> = {};
    for (let i = 0; i < 215; i++) {
      files[`d${String(i).padStart(3, "0")}.excalidraw`] = [
        text("a", "common"),
      ];
    }
    const { run } = await setup(files);
    let r = await run("common");
    expect([r.results.length, r.totalMatches]).toEqual([50, 215]);
    r = await run("common", { limit: 7 });
    expect([r.results.length, r.totalMatches]).toEqual([7, 215]);
    r = await run("common", { limit: 100000 });
    expect([r.results.length, r.totalMatches]).toEqual([200, 215]);
  });

  it("caps matches at five per drawing but reports the real matchCount", async () => {
    const { run } = await setup({
      "a.excalidraw": Array.from({ length: 12 }, (_, i) =>
        text(`e${i}`, `node ${i}`),
      ),
    });
    const h = (await run("node")).results[0];
    expect(h.matches).toHaveLength(5);
    expect(h.matchCount).toBe(12);
  });

  it("returns a ready status with counts and the echoed query", async () => {
    const { run } = await setup({
      "a.excalidraw": [text("a", "x")],
      "s/b.excalidraw": [text("a", "y")],
    });
    const r = await run("x");
    expect(r.query).toBe("x");
    expect(r.status).toMatchObject({ state: "ready", indexed: 2, total: 2 });
    expect(typeof r.tookMs).toBe("number");
  });

  it("setIndexState overrides the status and notifies subscribers", async () => {
    const { repo, search } = await setup({ "a.excalidraw": [text("a", "x")] });
    const seen: string[] = [];
    const off = await search.subscribe((s) =>
      seen.push(`${s.state}:${s.indexed}`),
    );
    search.setIndexState({ state: "building", indexed: 0 }, repo.vault.handle);
    await new Promise((r) => setTimeout(r, 20));
    expect(seen).toEqual(["building:0"]);
    off();
    search.setIndexState(null, repo.vault.handle);
    await new Promise((r) => setTimeout(r, 20));
    expect(seen).toHaveLength(1);
    expect((await search.status(repo.vault.handle)).state).toBe("ready");
  });
});

describe("FakeVaultSearch parity: ranking (Rust: name >> content, exact > prefix > mid-word)", () => {
  it("ranks a file-name match above a content match", async () => {
    const { paths } = await setup({
      "notes.excalidraw": [text("a", "dijkstra")],
      "dijkstra.excalidraw": [text("a", "unrelated")],
    });
    expect((await paths("dijkstra"))[0]).toBe("dijkstra.excalidraw");
  });

  it("ranks drawings with more hits first and breaks ties deterministically", async () => {
    const { paths } = await setup({
      "b.excalidraw": [text("a", "node")],
      "a.excalidraw": [text("a", "node")],
      "c.excalidraw": [text("a", "node"), text("b", "node")],
    });
    expect(await paths("node")).toEqual([
      "c.excalidraw",
      "a.excalidraw",
      "b.excalidraw",
    ]);
  });
});

describe("FakeVaultSearch known divergences from the Rust index", () => {
  it.fails(
    "keeps voiced and unvoiced kana distinct (NFKD+mark stripping turns が into か)",
    async () => {
      const { paths } = await setup({
        "a.excalidraw": [text("a", "がっこう")],
      });
      expect(await paths("か")).toEqual([]);
    },
  );

  // Rust folds katakana to hiragana, ß to ss and indexes originalText for bound labels.
  // The fake is test-only; these document the gap and flip to failing once it is closed.
  it.fails("folds katakana and hiragana together", async () => {
    const { paths } = await setup({ "a.excalidraw": [text("a", "カフェ")] });
    expect(await paths("かふぇ")).toEqual(["a.excalidraw"]);
  });

  it.fails("folds ß to ss", async () => {
    const { paths } = await setup({ "a.excalidraw": [text("a", "Straße")] });
    expect(await paths("strasse")).toEqual(["a.excalidraw"]);
  });

  it.fails(
    "indexes originalText (no auto-wrap newlines) for bound labels",
    async () => {
      const { run } = await setup({
        "a.excalidraw": [
          text("l", "Dijkstra\nshortest", {
            originalText: "Dijkstra shortest path",
            containerId: "r",
          }),
        ],
      });
      expect(first(await run("path")).snippet).toBe("Dijkstra shortest path");
    },
  );
});
