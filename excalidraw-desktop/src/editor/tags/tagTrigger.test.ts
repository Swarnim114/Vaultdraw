import { describe, expect, it } from "vitest";

import { WikiAutocomplete } from "../links/wikiAutocomplete";
import { createResolver } from "../../links/resolve";
import { DEFAULT_LINKS_SETTINGS } from "../../links/types";
import { DEFAULT_TAGS_SETTINGS } from "../../tags/types";

import { rankTags } from "./tagRank";
import { findOpenTag, insertTag } from "./tagTrigger";

import type { TagCount } from "../../tags/types";

const tc = (display: string, count: number): TagCount => ({
  tag: display.toLowerCase(),
  display,
  count,
});
const TAGS = [
  tc("algo", 2),
  tc("DSA", 9),
  tc("DSA/Graphs", 4),
  tc("DSA/Trees", 4),
  tc("design", 3),
  tc("Graphics", 1),
  tc("todo", 7),
];

describe("findOpenTag", () => {
  const find = (s: string, caret = s.length) => findOpenTag(s, caret);
  it("finds # at line start, after space and after openers", () => {
    expect(find("#")).toMatchObject({ start: 0, query: "" });
    expect(find("see #ds")).toMatchObject({ start: 4, query: "ds" });
    expect(find("a\n#x")).toMatchObject({ start: 2, query: "x" });
    expect(find("(#x")).toMatchObject({ start: 1, query: "x" });
    expect(find("a, #x")).toMatchObject({ start: 3, query: "x" });
  });
  it("supports nested tags", () => {
    expect(find("#dsa/")).toMatchObject({ query: "dsa/" });
    expect(find("#dsa/gr")).toMatchObject({ query: "dsa/gr" });
  });
  it("is null where the grammar would not open a tag", () => {
    expect(find("abc#x")).toBeNull();
    expect(find("&#x")).toBeNull();
    expect(find("http://a/#b")).toBeNull();
    expect(find("## x")).toBeNull();
    expect(find("# ")).toBeNull();
    expect(find("#-a")).toBeNull();
    expect(find("#a//b")).toBeNull();
    expect(find("plain text")).toBeNull();
    expect(find("")).toBeNull();
    expect(find(`#${"x".repeat(100)}`)).toBeNull();
  });
  it("extends the token over tag characters after the caret", () => {
    expect(find("#dsarest more", 4)).toMatchObject({ query: "dsa", end: 8 });
  });
});

describe("insertTag", () => {
  const open = (s: string, caret = s.length) => findOpenTag(s, caret)!;
  it("replaces the token and adds a trailing space at the end", () => {
    expect(insertTag("see #ds", open("see #ds"), "#DSA")).toEqual({
      value: "see #DSA ",
      caret: 9,
    });
  });
  it("adds no space before existing whitespace", () => {
    expect(insertTag("#ds more", open("#ds more", 3), "#DSA")).toEqual({
      value: "#DSA more",
      caret: 4,
    });
  });
  it("replaces trailing tag characters and adds a space before other text", () => {
    expect(insertTag("(#dsarest)", open("(#dsarest)", 4), "#DSA")).toEqual({
      value: "(#DSA )",
      caret: 6,
    });
  });
});

describe("rankTags", () => {
  const names = (q: string) => rankTags(TAGS, q, 8).map((r) => r.tag.display);
  it("lists the top tags by count for an empty query", () => {
    expect(names("")).toEqual([
      "DSA",
      "todo",
      "DSA/Graphs",
      "DSA/Trees",
      "design",
      "algo",
      "Graphics",
    ]);
  });
  it("ranks key prefix, then segment prefix, then contains, then fuzzy", () => {
    // prefix (Graphics) beats segment prefix (DSA/Graphs)
    expect(names("gra")).toEqual(["Graphics", "DSA/Graphs"]);
    expect(names("rap")).toEqual(["DSA/Graphs", "Graphics"]);
    expect(names("dg")).toEqual(["DSA/Graphs", "design"]);
  });
  it("folds case and lists children for a nested query", () => {
    expect(names("DSA/")).toEqual(["DSA/Graphs", "DSA/Trees"]);
  });
  it("caps rows and reports highlight positions", () => {
    expect(rankTags(TAGS, "", 3)).toHaveLength(3);
    expect(rankTags(TAGS, "rap", 8)[0].positions).toEqual([5, 6, 7]);
  });
});

describe("WikiAutocomplete # trigger", () => {
  async function setup(
    tagsAutocomplete = true,
    links: Partial<typeof DEFAULT_LINKS_SETTINGS> = {},
  ) {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const names = ["Notes.excalidraw"];
    const ac = new WikiAutocomplete({
      container,
      getNames: () => names,
      getResolver: () => createResolver(names),
      getSettings: () => ({ ...DEFAULT_LINKS_SETTINGS, ...links }),
      getCurrentPath: () => null,
      onCreate: () => {},
      getTags: () => TAGS,
      getTagsSettings: () => ({
        ...DEFAULT_TAGS_SETTINGS,
        autocomplete: tagsAutocomplete,
      }),
    });
    ac.start();
    const ta = document.createElement("textarea");
    ta.className = "excalidraw-wysiwyg";
    container.appendChild(ta);
    await new Promise((r) => setTimeout(r, 0));
    const type = (value: string, caret = value.length) => {
      ta.value = value;
      ta.setSelectionRange(caret, caret);
      ta.dispatchEvent(new Event("input", { bubbles: true }));
    };
    const key = (k: string, init: KeyboardEventInit = {}) => {
      const e = new KeyboardEvent("keydown", {
        key: k,
        bubbles: true,
        cancelable: true,
        ...init,
      });
      ta.dispatchEvent(e);
      return e;
    };
    return { ac, ta, type, key };
  }

  it("shows rows with counts, no create row, and inserts #Display", async () => {
    const { ac, ta, type, key } = await setup();
    type("note #dsa/g");
    expect(ac.state?.rows.map((r) => [r.target, r.count])).toEqual([
      ["#DSA/Graphs", 4],
    ]);
    expect(ac.state?.create).toBeNull();
    expect(key("Enter").defaultPrevented).toBe(true);
    expect(ta.value).toBe("note #DSA/Graphs ");
    expect(ta.selectionStart).toBe(17);
    expect(ac.state).toBeNull();
  });

  it("# alone shows the top tags; navigation and Escape work", async () => {
    const { ac, type, key } = await setup();
    type("#");
    expect(ac.state?.rows[0].target).toBe("#DSA");
    key("n", { ctrlKey: true });
    expect(ac.state?.selected).toBe(1);
    key("ArrowUp");
    expect(ac.state?.selected).toBe(0);
    expect(key("Escape").defaultPrevented).toBe(true);
    expect(ac.state).toBeNull();
  });

  it("closes when nothing matches, and for non-tag text", async () => {
    const { ac, type } = await setup();
    type("#zzqq");
    expect(ac.state).toBeNull();
    type("abc#d");
    expect(ac.state).toBeNull();
  });

  it("[[ wins over # inside a link", async () => {
    const { ac, type } = await setup();
    type("[[Not#");
    expect(ac.state?.rows.every((r) => r.count === undefined)).toBe(true);
  });

  it("is inert when tags.autocomplete is off, even if links are on", async () => {
    const { ac, type } = await setup(false);
    type("#ds");
    expect(ac.state).toBeNull();
    type("[[Not");
    expect(ac.state).not.toBeNull();
  });

  it("works when links autocomplete is off", async () => {
    const { ac, type } = await setup(true, { autocomplete: false });
    type("#ds");
    expect(ac.state).not.toBeNull();
    type("[[Not");
    expect(ac.state).toBeNull();
  });
});
