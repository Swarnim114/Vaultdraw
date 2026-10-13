import { describe, expect, it, vi } from "vitest";

import {
  ensureFolder,
  folderChain,
  resolveNewDrawingParent,
} from "../vault/newDrawing";

import type { VaultRepository } from "../vault/types";

describe("resolveNewDrawingParent", () => {
  it("uses the setting, else the open drawing's folder, else the root", () => {
    expect(resolveNewDrawingParent("Inbox", "a/b.excalidraw")).toBe("Inbox");
    expect(resolveNewDrawingParent("", "a/b.excalidraw")).toBe("a");
    expect(resolveNewDrawingParent("", null)).toBe("");
  });
});

describe("ensureFolder", () => {
  it("builds the chain", () => {
    expect(folderChain("a/b/c")).toEqual(["a", "a/b", "a/b/c"]);
    expect(folderChain("")).toEqual([]);
  });

  it("creates only the missing folders", async () => {
    const existing = new Set(["a"]);
    const repo = {
      listDirectory: vi.fn(async (_h: string, p: string) => {
        if (!existing.has(p)) throw new Error("NOT_FOUND");
        return [];
      }),
      createFolder: vi.fn(async (_h: string, p: string) => {
        existing.add(p);
      }),
    } as unknown as VaultRepository;
    expect(await ensureFolder(repo, "h", "a/b/c")).toEqual(["a/b", "a/b/c"]);
    expect(await ensureFolder(repo, "h", "a/b/c")).toEqual([]);
  });
});
