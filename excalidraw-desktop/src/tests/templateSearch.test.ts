import { describe, expect, it } from "vitest";

import { filterTemplates } from "../templates/search";

import type { TemplateEntry } from "../templates/types";

const e = (name: string): TemplateEntry => ({
  source: "vault",
  path: `T/${name}.excalidraw`,
  name,
  modifiedAt: 1,
  size: 1,
});

const names = (l: TemplateEntry[]) => l.map((x) => x.name);

describe("filterTemplates", () => {
  const all = [
    e("Weekly lecture"),
    e("Lecture notes"),
    e("Pre-lecture"),
    e("lcr"),
  ];

  it("returns input order for empty query", () => {
    expect(filterTemplates(all, "  ")).toBe(all);
  });

  it("ranks prefix > word-prefix > substring > subsequence, case-insensitive", () => {
    const list = [
      e("xlectured"),
      e("Weekly Lecture"),
      e("Lecture"),
      e("l-e-c-t"),
    ];
    expect(names(filterTemplates(list, "LECT"))).toEqual([
      "Lecture",
      "Weekly Lecture",
      "xlectured",
      "l-e-c-t",
    ]);
  });

  it("is stable within a tier and drops non-matches", () => {
    expect(names(filterTemplates(all, "lecture"))).toEqual([
      "Lecture notes",
      "Weekly lecture",
      "Pre-lecture",
    ]);
    expect(filterTemplates(all, "zzz")).toEqual([]);
  });
});
