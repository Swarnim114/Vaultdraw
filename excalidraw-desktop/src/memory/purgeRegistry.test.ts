import { describe, expect, it, vi } from "vitest";

import { purgeAll, registerPurge } from "./purgeRegistry";

describe("purge registry", () => {
  it("runs all purges, survives failures, and unregisters", async () => {
    const a = vi.fn();
    const bad = vi.fn(() => {
      throw new Error("x");
    });
    const c = vi.fn();
    const offA = registerPurge("a", a);
    registerPurge("bad", bad);
    registerPurge("c", c);
    expect(await purgeAll("hidden")).toEqual(["a", "c"]);
    offA();
    await purgeAll("pressure");
    expect(a).toHaveBeenCalledTimes(1);
    expect(c).toHaveBeenCalledTimes(2);
  });

  it("idle runs only offscreen-scoped purges", async () => {
    const all = vi.fn();
    const off = vi.fn();
    registerPurge("all2", all, { scope: "all" });
    registerPurge("off2", off, { scope: "offscreen" });
    await purgeAll("idle");
    expect(all).not.toHaveBeenCalled();
    expect(off).toHaveBeenCalledTimes(1);
  });
});
