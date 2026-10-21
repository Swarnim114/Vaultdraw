import { describe, expect, it } from "vitest";

import { clickTarget, isNewTabClick } from "./newTabClick";

describe("newTabClick", () => {
  it("meta or ctrl asks for a new tab", () => {
    expect(isNewTabClick({ metaKey: true, ctrlKey: false })).toBe(true);
    expect(isNewTabClick({ metaKey: false, ctrlKey: true })).toBe(true);
    expect(isNewTabClick({ metaKey: false, ctrlKey: false })).toBe(false);
  });
  it("target is only set for the new-tab gesture", () => {
    expect(clickTarget({ metaKey: true, ctrlKey: false })).toBe("new");
    expect(clickTarget({ metaKey: false, ctrlKey: false })).toBeUndefined();
  });
});
