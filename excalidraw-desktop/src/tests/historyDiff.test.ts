import { describe, expect, it } from "vitest";

import { diffScenes } from "../history/diff";

const el = (id: string, extra: Record<string, unknown> = {}) =>
  ({
    id,
    type: "rectangle",
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    version: 1,
    versionNonce: 1,
    isDeleted: false,
    ...extra,
  } as any);

describe("diffScenes", () => {
  it("classifies only-in-version, not-in-version and changed", () => {
    const version = [
      el("a"),
      el("b"),
      el("c", { version: 2, versionNonce: 9 }),
    ];
    const current = [el("b"), el("c"), el("d")];
    const d = diffScenes(version, current);
    expect(d.added).toEqual(["a"]);
    expect(d.changed).toEqual(["c"]);
    expect(d.removed.map((e) => e.id)).toEqual(["d"]);
  });

  it("treats deleted elements as absent on both sides", () => {
    const version = [el("a", { isDeleted: true }), el("b")];
    const current = [el("a"), el("b", { isDeleted: true })];
    const d = diffScenes(version, current);
    expect(d.added).toEqual(["b"]);
    expect(d.removed.map((e) => e.id)).toEqual(["a"]);
    expect(d.changed).toEqual([]);
  });

  it("is empty for identical scenes", () => {
    const s = [el("a"), el("b")];
    expect(diffScenes(s, s)).toEqual({ added: [], removed: [], changed: [] });
  });

  it("counts a bound text with its container", () => {
    const box = (v = 1) => el("box", { version: v, versionNonce: v });
    const text = (v = 1) =>
      el("t", {
        type: "text",
        containerId: "box",
        version: v,
        versionNonce: v,
      });
    // Text edited only: the container is reported, not the text.
    expect(diffScenes([box(), text(1)], [box(), text(2)]).changed).toEqual([
      "box",
    ]);
    // Container and text both new in the version: one entry.
    expect(diffScenes([box(), text()], []).added).toEqual(["box"]);
    // Both new in current: one ghost.
    expect(diffScenes([], [box(), text()]).removed.map((e) => e.id)).toEqual([
      "box",
    ]);
  });

  it("diffs 5k elements within budget", () => {
    const n = 5000;
    const version = Array.from({ length: n }, (_, i) => el(`e${i}`));
    const current = Array.from({ length: n }, (_, i) =>
      i % 10 === 0
        ? el(`e${i}`, { version: 2 })
        : el(`e${i + (i % 7 === 0 ? n : 0)}`),
    );
    diffScenes(version, current); // warm up
    const runs = 10;
    const t = performance.now();
    for (let i = 0; i < runs; i++) {
      diffScenes(version, current);
    }
    const ms = (performance.now() - t) / runs;
    // eslint-disable-next-line no-console
    console.log(`diffScenes 5k elements: ${ms.toFixed(2)} ms`);
    expect(ms).toBeLessThan(10);
  });
});
