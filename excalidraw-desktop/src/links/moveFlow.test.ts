import { describe, expect, it, vi } from "vitest";

import { createSpot } from "./createTarget";
import { decideMove, updatedMessage } from "./moveFlow";

import type { ConfirmRequest } from "./moveFlow";
import type { MovePlan, UpdateOnRename, VaultLinks } from "./types";

const plan = (over: Partial<MovePlan> = {}): MovePlan => ({
  files: 2,
  links: 3,
  rePointed: [],
  ...over,
});

const setup = (
  mode: UpdateOnRename,
  p: MovePlan | Error | null,
  answers: boolean[] = [],
) => {
  const planMove = vi.fn(async () => {
    if (p instanceof Error) {
      throw p;
    }
    return p as MovePlan;
  });
  const confirm = vi.fn(
    async (_req: ConfirmRequest) => answers.shift() ?? true,
  );
  const links = p === null ? null : ({ planMove } as unknown as VaultLinks);
  return {
    planMove,
    confirm,
    run: () => decideMove({ links, handle: "h", mode, confirm }, "a", "b"),
  };
};

describe("decideMove", () => {
  it("is a plain move without a link index", async () => {
    const t = setup(true, null);
    expect(await t.run()).toBe("plain");
    expect(t.confirm).not.toHaveBeenCalled();
  });

  it("true: rewrites without asking", async () => {
    const t = setup(true, plan());
    expect(await t.run()).toBe("rewrite");
    expect(t.confirm).not.toHaveBeenCalled();
  });

  it("true: plain when nothing links to it", async () => {
    expect(await setup(true, plan({ files: 0, links: 0 })).run()).toBe("plain");
  });

  it("true: still rewrites when the plan fails", async () => {
    expect(await setup(true, new Error("x")).run()).toBe("rewrite");
  });

  it("false: plain move", async () => {
    const t = setup(false, plan());
    expect(await t.run()).toBe("plain");
    expect(t.confirm).not.toHaveBeenCalled();
  });

  it("ask: confirm decides rewrite or plain", async () => {
    const yes = setup("ask", plan(), [true]);
    expect(await yes.run()).toBe("rewrite");
    expect(yes.confirm.mock.calls[0][0].message).toBe(
      "Update 3 links in 2 drawings?",
    );
    expect(await setup("ask", plan(), [false]).run()).toBe("plain");
  });

  it("ask: no prompt with no links", async () => {
    const t = setup("ask", plan({ files: 0, links: 0 }));
    expect(await t.run()).toBe("plain");
    expect(t.confirm).not.toHaveBeenCalled();
  });

  it.each<UpdateOnRename>([true, false, "ask"])(
    "rePointed asks first in mode %s, and declining aborts",
    async (mode) => {
      const rp = plan({
        rePointed: [
          {
            path: "x.excalidraw",
            target: "T",
            from: "a/T.excalidraw",
            to: null,
          },
        ],
      });
      const t = setup(mode, rp, [false]);
      expect(await t.run()).toBe("abort");
      expect(t.confirm).toHaveBeenCalledTimes(1);
      const req = t.confirm.mock.calls[0][0];
      expect(req.details).toEqual(["x: [[T]] a/T → nothing"]);
    },
  );

  it("rePointed accepted continues with the mode", async () => {
    const rp = plan({
      rePointed: [
        { path: "x.excalidraw", target: "T", from: null, to: "T.excalidraw" },
      ],
    });
    expect(await setup("ask", rp, [true, true]).run()).toBe("rewrite");
    expect(await setup("ask", rp, [true, false]).run()).toBe("plain");
    expect(await setup(false, rp, [true]).run()).toBe("plain");
  });
});

describe("updatedMessage", () => {
  it("pluralises", () => {
    expect(updatedMessage(1, 1)).toBe("Updated 1 link in 1 drawing");
    expect(updatedMessage(4, 2)).toBe("Updated 4 links in 2 drawings");
  });
});

describe("createSpot", () => {
  it("bare names go to the default parent", () => {
    expect(createSpot("Idea", "Inbox", "a/b.excalidraw")).toEqual({
      parent: "Inbox",
      name: "Idea.excalidraw",
    });
  });
  it("folder targets are vault-root relative", () => {
    expect(createSpot("Graphs/BFS", "Inbox", "a/b.excalidraw")).toEqual({
      parent: "Graphs",
      name: "BFS.excalidraw",
    });
  });
  it("./ and ../ resolve against the open drawing", () => {
    expect(createSpot("./x", "Inbox", "a/b.excalidraw")).toEqual({
      parent: "a",
      name: "x.excalidraw",
    });
    expect(createSpot("../y", "Inbox", "a/b.excalidraw")).toEqual({
      parent: "",
      name: "y.excalidraw",
    });
    expect(createSpot("../../y", "", "a/b.excalidraw")).toBeNull();
  });
  it("strips the extension and illegal characters", () => {
    expect(createSpot("a:b.excalidraw", "", null)?.name).toBe("ab.excalidraw");
    expect(createSpot("  ", "", null)).toBeNull();
  });
});
