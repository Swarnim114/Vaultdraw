import { describe, expect, it } from "vitest";

import {
  customisedTabTitle,
  vaultScopeDisabledReason,
} from "../components/settings/scopeHelp";

describe("scope help wording", () => {
  it("explains why This vault is unavailable", () => {
    expect(vaultScopeDisabledReason({ readOnly: true })).toBe(
      "This vault is read-only, so vault settings can't be saved",
    );
    expect(
      vaultScopeDisabledReason({
        readOnly: true,
        readOnlyReason: "lockedByOtherProcess",
      }),
    ).toBe(
      "This vault is read-only (open in another Vaultdraw), so vault settings can't be saved",
    );
    expect(vaultScopeDisabledReason({ readOnly: false })).toBeNull();
    expect(vaultScopeDisabledReason(null)).toBeNull();
  });

  it("tab titles say what the dot means only when customised", () => {
    expect(customisedTabTitle("Arrow", false)).toBe("Arrow");
    expect(customisedTabTitle("Arrow", true)).toBe(
      "Arrow: this tool has customised defaults",
    );
  });
});
