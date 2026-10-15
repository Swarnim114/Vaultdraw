import { describe, expect, it, vi } from "vitest";

import { DesktopVaultLinks } from "./DesktopVaultLinks";

describe("DesktopVaultLinks", () => {
  it("maps methods to commands with camelCase arguments", async () => {
    const invoke = vi.fn(async () => ({}));
    const links = new DesktopVaultLinks({ invoke: invoke as never });
    await links.links("h", "a.excalidraw");
    await links.unlinkedMentions("h", "a.excalidraw", 5);
    await links.resolve("h", "a.excalidraw", "[[b]]");
    await links.planMove("h", "a", "b");
    await links.moveWithLinks("h", "a", "b", "o", true);
    await links.remeasure("h");
    await links.remeasureDone("h", "p");
    expect(invoke.mock.calls).toEqual([
      ["vault_links", { handle: "h", path: "a.excalidraw" }],
      [
        "vault_unlinked_mentions",
        { handle: "h", path: "a.excalidraw", limit: 5 },
      ],
      ["resolve_link", { handle: "h", fromPath: "a.excalidraw", raw: "[[b]]" }],
      ["links_plan_move", { handle: "h", from: "a", to: "b" }],
      [
        "move_entry_with_links",
        { handle: "h", from: "a", to: "b", openPath: "o", rewrite: true },
      ],
      ["links_remeasure", { handle: "h" }],
      ["links_remeasure_done", { handle: "h", path: "p" }],
    ]);
  });
  it("subscribes to links-rewrite-done and unwraps the payload", async () => {
    const off = vi.fn();
    const listen = vi.fn(
      async (_n: string, cb: (e: { payload: unknown }) => void) => {
        cb({ payload: { jobId: 3 } });
        return off;
      },
    );
    const got: unknown[] = [];
    const unsub = await new DesktopVaultLinks({
      listen: listen as never,
    }).onRewriteDone((d) => got.push(d));
    expect(listen.mock.calls[0][0]).toBe("links-rewrite-done");
    expect(got).toEqual([{ jobId: 3 }]);
    expect(unsub).toBe(off);
  });
  it("normalises errors", async () => {
    const invoke = vi.fn(async () => {
      return Promise.reject({ code: "NOT_FOUND", message: "nope" });
    });
    await expect(
      new DesktopVaultLinks({ invoke: invoke as never }).links("h", "x"),
    ).rejects.toBeInstanceOf(Error);
  });
});
