import { newElement } from "@excalidraw/element";
import { serializeLibraryAsJSON } from "@excalidraw/excalidraw";

import type { LibraryItem } from "@excalidraw/excalidraw/types";

import { LibraryStore } from "../library/libraryStore";

import { FakeLibraryRepository } from "./fakeLibraryRepository";

const item = (id: string, x = 0): LibraryItem => ({
  id,
  status: "unpublished",
  created: 1,
  elements: [
    newElement({ type: "rectangle", x, y: 0, width: 10, height: 10 }) as any,
  ],
});
const json = (...ids: string[]) =>
  serializeLibraryAsJSON(ids.map((id) => item(id)));
const ids = (items: readonly LibraryItem[]) => items.map((i) => i.id);
const settle = () => vi.advanceTimersByTimeAsync(0);

describe("LibraryStore", () => {
  let repo: FakeLibraryRepository;
  let idle: (() => void)[];
  let store: LibraryStore;

  beforeEach(() => {
    vi.useFakeTimers();
    repo = new FakeLibraryRepository();
    idle = [];
    store = new LibraryStore(repo, { scheduleIdle: (run) => idle.push(run) });
  });
  afterEach(() => {
    store.dispose();
    vi.useRealTimers();
  });

  const load = async () => {
    const p = store.adapter.load({ source: "load" });
    idle.forEach((run) => run());
    return (await p)!.libraryItems as LibraryItem[];
  };
  const save = (items: LibraryItem[]) =>
    store.adapter.save({ libraryItems: items });

  it("waits for idle before the first load, but not after loadNow", async () => {
    repo.setFile("personal", json("a"));
    let done = false;
    void store.adapter.load({ source: "load" }).then(() => (done = true));
    await settle();
    expect(done).toBe(false);
    expect(repo.readLog).toHaveLength(0);
    await store.loadNow();
    await settle();
    expect(done).toBe(true);

    const other = new LibraryStore(repo, { scheduleIdle: () => {} });
    await other.loadNow();
    expect(ids(other.union())).toEqual(["a"]);
    other.dispose();
  });

  it("returns personal then vault items", async () => {
    repo.setFile("personal", json("p1", "p2"));
    repo.setFile("vault", json("v1"), "h");
    await store.setVault("h");
    expect(ids(await load())).toEqual(["p1", "p2", "v1"]);
    expect(store.sectionOf("v1")).toBe("vault");
    expect(store.sectionOf("p1")).toBe("personal");
  });

  it("splits saves by origin; unknown ids go to personal", async () => {
    repo.setFile("vault", json("v1"), "h");
    await store.setVault("h");
    const items = await load();
    save([item("new"), ...items]);
    await vi.advanceTimersByTimeAsync(700);
    expect(repo.getJson("personal")).toContain('"new"');
    expect(repo.getJson("personal")).not.toContain('"v1"');
    expect(repo.writes.filter((w) => w.key === "vault:h")).toHaveLength(0);
  });

  it("does not create the vault file until it has an item", async () => {
    await store.setVault("h");
    await load();
    save([item("p")]);
    await vi.advanceTimersByTimeAsync(700);
    expect(repo.getJson("vault", "h")).toBeNull();
    store.assign(["v"], "vault");
    save([item("v"), item("p")]);
    await vi.advanceTimersByTimeAsync(700);
    expect(ids(JSON.parse(repo.getJson("vault", "h")!).libraryItems)).toEqual([
      "v",
    ]);
  });

  it("coalesces a burst into one write", async () => {
    await load();
    for (let i = 1; i <= 5; i++) {
      save(Array.from({ length: i }, (_, n) => item(`i${n}`)));
      await vi.advanceTimersByTimeAsync(100);
    }
    await vi.advanceTimersByTimeAsync(700);
    expect(repo.writes).toHaveLength(1);
    expect(ids(JSON.parse(repo.writes[0].json).libraryItems)).toHaveLength(5);
  });

  it("re-applies local changes after a CAS conflict", async () => {
    repo.setFile("personal", json("a"));
    await load();
    save([item("local"), item("a")]);
    // Another writer adds "ext" before our debounced write lands.
    repo.files.set("personal", {
      json: json("ext", "a"),
      revision: 99,
    });
    await vi.advanceTimersByTimeAsync(700);
    const written = ids(JSON.parse(repo.getJson("personal")!).libraryItems);
    expect(written.sort()).toEqual(["a", "ext", "local"]);
    expect(ids(store.union()).sort()).toEqual(["a", "ext", "local"]);
  });

  it("lets disk win on an external change without pending edits", async () => {
    repo.setFile("personal", json("a", "b"));
    await load();
    const kinds: string[] = [];
    store.subscribe((k) => kinds.push(k));
    repo.setFile("personal", json("b", "c"));
    await settle();
    expect(ids(store.union())).toEqual(["b", "c"]);
    expect(kinds).toContain("external");
    await vi.advanceTimersByTimeAsync(2500);
    expect(repo.writes).toHaveLength(0);
  });

  it("skips self-echo events via the known revision", async () => {
    await load();
    save([item("a")]);
    await vi.advanceTimersByTimeAsync(700);
    const kinds: string[] = [];
    store.subscribe((k) => kinds.push(k));
    repo.emit({ scope: "personal" });
    await settle();
    expect(repo.readLog.at(-1)?.unchanged).toBe(true);
    expect(kinds).not.toContain("external");
  });

  it("marks an invalid file read-only and never writes it", async () => {
    repo.setFile("personal", "{ not json");
    await load();
    expect(store.getErrors()[0]).toMatch(/could not be read/);
    save([item("a")]);
    await vi.advanceTimersByTimeAsync(2500);
    await store.flush();
    expect(repo.writes).toHaveLength(0);
    expect(repo.getJson("personal")).toBe("{ not json");
  });

  it("retries a torn file once before flagging it", async () => {
    repo.setFile("personal", json("a"));
    await load();
    repo.files.set("personal", { json: "{", revision: 50 });
    repo.emit({ scope: "personal" });
    await vi.advanceTimersByTimeAsync(100);
    repo.files.set("personal", { json: json("a", "b"), revision: 51 });
    await vi.advanceTimersByTimeAsync(400);
    expect(store.getErrors()).toEqual([]);
    expect(ids(store.union())).toEqual(["a", "b"]);
  });

  it("rewrites both files when an item moves between sources", async () => {
    repo.setFile("personal", json("a", "b"));
    repo.setFile("vault", json("v"), "h");
    await store.setVault("h");
    await load();
    store.assign(["a"], "vault");
    await vi.advanceTimersByTimeAsync(700);
    expect(ids(JSON.parse(repo.getJson("personal")!).libraryItems)).toEqual([
      "b",
    ]);
    expect(
      ids(JSON.parse(repo.getJson("vault", "h")!).libraryItems).sort(),
    ).toEqual(["a", "v"]);
    expect(store.sectionOf("a")).toBe("vault");
  });

  it("refuses assigning to a read-only vault", async () => {
    await store.setVault("h", true);
    await load();
    store.assign(["x"], "vault");
    expect(store.sectionOf("x")).toBe("personal");
    expect(store.isVaultReadOnly()).toBe(true);
  });

  it("flush writes pending changes immediately", async () => {
    await load();
    save([item("a")]);
    await store.flush();
    expect(repo.writes).toHaveLength(1);
  });

  it("keeps its cache across editor remounts and writes nothing for identical saves", async () => {
    repo.setFile("personal", json("a"));
    const first = await load();
    const reads = repo.readLog.length;
    const again = (await store.adapter.load({ source: "save" }))!
      .libraryItems as LibraryItem[];
    expect(ids(again)).toEqual(ids(first));
    expect(repo.readLog.length).toBe(reads);
    save(again);
    await vi.advanceTimersByTimeAsync(2500);
    expect(repo.writes).toHaveLength(0);
  });
});
