import { describe, expect, it } from "vitest";

import { DEFAULT_PAGE_SETUP } from "@excalidraw/excalidraw/data/pageSetup";

import {
  getContentBottom,
  getExtendedPageCount,
  OutsideIndex,
} from "./pageContent";
import { boundText, rect, toMap } from "./testElements";
import { VersionTracker } from "./versionTracker";

const setup = { ...DEFAULT_PAGE_SETUP, pageCount: 1 };
const H = setup.height;

describe("auto-extend", () => {
  it("adds a page when content reaches the last quarter", () => {
    const a = rect(10, H * 0.8, 100, 20);
    expect(getExtendedPageCount(setup, [a], toMap([a]))).toBe(2);
  });

  it("does not add one for content in the upper part", () => {
    const a = rect(10, 100);
    expect(getExtendedPageCount(setup, [a], toMap([a]))).toBe(1);
  });

  it("never shrinks", () => {
    const s = { ...setup, pageCount: 5 };
    const a = rect(10, 10);
    expect(getExtendedPageCount(s, [a], toMap([a]))).toBe(5);
  });

  it("ignores deleted elements and those beside the page column", () => {
    const gone = rect(10, H * 0.9, 50, 50, { isDeleted: true });
    const beside = rect(setup.width + 500, H * 0.9);
    expect(getContentBottom(setup, [gone, beside], toMap([gone, beside]))).toBe(
      0,
    );
  });
});

describe("OutsideIndex", () => {
  it("counts elements outside every page and follows changes", () => {
    const index = new OutsideIndex();
    const inside = rect(10, 10);
    const out = rect(-500, 10);
    const map = toMap([inside, out]);
    index.rebuild(setup, [inside, out], map);
    expect(index.size).toBe(1);
    const fixed = { ...out, x: 10, version: out.version + 1 };
    index.update(setup, [fixed], toMap([inside, fixed]));
    expect(index.size).toBe(0);
    index.update(setup, [{ ...fixed, isDeleted: true }], map);
    expect(index.size).toBe(0);
  });

  it("does not count bound text on its own", () => {
    const { container, text } = boundText(rect(10, 10));
    const index = new OutsideIndex();
    index.rebuild(
      setup,
      [container, { ...text, x: -900 }],
      toMap([container, text]),
    );
    expect(index.size).toBe(0);
  });
});

describe("VersionTracker", () => {
  it("reports added and changed elements only, once", () => {
    const tracker = new VersionTracker();
    const a = rect(0, 0);
    const b = rect(0, 0);
    tracker.seed([a, b]);
    expect(tracker.diff([a, b])).toEqual([]);
    const b2 = { ...b, version: b.version + 1 };
    const c = rect(5, 5);
    expect(tracker.diff([a, b2, c])).toEqual([b2, c]);
    expect(tracker.diff([a, b2, c])).toEqual([]);
  });

  it("mark() records our own corrections", () => {
    const tracker = new VersionTracker();
    const a = rect(0, 0);
    tracker.seed([a]);
    const moved = { ...a, version: a.version + 1 };
    tracker.mark([moved]);
    expect(tracker.diff([moved])).toEqual([]);
  });
});
