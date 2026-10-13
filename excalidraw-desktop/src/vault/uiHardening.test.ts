import { describe, expect, it, vi } from "vitest";

import {
  DesktopVaultRepository,
  isTauriAvailable,
} from "./DesktopVaultRepository";
import {
  addRecentVault,
  getExpandedFolders,
  getLastVaultPath,
  setExpandedFolders,
} from "./preferences";
import {
  MAX_SEARCH_RESULTS,
  scanVaultMetadata,
  searchEntries,
} from "./treeStore";

import type { VaultEntry, VaultInfo, VaultRepository } from "./types";

describe("DesktopVaultRepository hardening", () => {
  it("exportFile is bound and callable when destructured without this context", async () => {
    const mockInvoke = vi.fn().mockResolvedValue(true);
    const repo = new DesktopVaultRepository({ invoke: mockInvoke });

    const { exportFile } = repo;
    const result = await exportFile(
      "test.excalidraw",
      new Uint8Array([1, 2, 3]),
    );

    expect(result).toBe(true);
    expect(mockInvoke).toHaveBeenCalledWith(
      "export_file",
      new Uint8Array([1, 2, 3]),
      {
        headers: { "x-file-name": "test.excalidraw" },
      },
    );
  });

  it("reopenVault coalesces concurrent in-flight requests into one native invocation", async () => {
    let resolveInvoke: (val: VaultInfo | null) => void;
    const invokePromise = new Promise<VaultInfo | null>((resolve) => {
      resolveInvoke = resolve;
    });
    const mockInvoke = vi.fn().mockReturnValue(invokePromise);
    const repo = new DesktopVaultRepository({ invoke: mockInvoke });

    // Fire two concurrent reopen calls
    const call1 = repo.reopenVault();
    const call2 = repo.reopenVault();

    // Allow getInvoke() promise resolution microtask to advance
    await Promise.resolve();

    // Verify invoke was only called once
    expect(mockInvoke).toHaveBeenCalledTimes(1);

    const fakeVault: VaultInfo = {
      handle: "v-1",
      path: "/test/vault",
      name: "vault",
      readOnly: false,
    };
    resolveInvoke!(fakeVault);

    const [res1, res2] = await Promise.all([call1, call2]);
    expect(res1).toEqual(fakeVault);
    expect(res2).toEqual(fakeVault);

    // After settling, next call makes a new invocation
    mockInvoke.mockResolvedValueOnce(null);
    const call3 = await repo.reopenVault();
    expect(call3).toBeNull();
    expect(mockInvoke).toHaveBeenCalledTimes(2);
  });

  it("isTauriAvailable respects injected window without arbitrary global pollution", () => {
    expect(isTauriAvailable(null)).toBe(false);

    const fakeTauriWin = {
      __TAURI_INTERNALS__: { invoke: () => {} },
    } as unknown as Window;
    expect(isTauriAvailable(fakeTauriWin)).toBe(true);
  });
});

describe("Preferences per-vault stable path keying", () => {
  it("keys expanded folders by stable vault path instead of ephemeral handle", () => {
    const fakeStorage: Record<string, string> = {};
    const fakeWin = {
      localStorage: {
        getItem: (k: string) => fakeStorage[k] ?? null,
        setItem: (k: string, v: string) => {
          fakeStorage[k] = v;
        },
      },
    } as unknown as Window;

    const stableVaultPath = "/Users/artist/vault";
    setExpandedFolders(stableVaultPath, ["FolderA", "FolderB"], fakeWin);

    expect(getExpandedFolders(stableVaultPath, fakeWin)).toEqual([
      "FolderA",
      "FolderB",
    ]);
    // Different path should return default
    expect(getExpandedFolders("/different/path", fakeWin)).toEqual([""]);
  });

  it("tracks lastVaultPath correctly for safe reopen matching", () => {
    const fakeStorage: Record<string, string> = {};
    const fakeWin = {
      localStorage: {
        getItem: (k: string) => fakeStorage[k] ?? null,
        setItem: (k: string, v: string) => {
          fakeStorage[k] = v;
        },
      },
    } as unknown as Window;

    addRecentVault("/vault/alpha", fakeWin);
    expect(getLastVaultPath(fakeWin)).toBe("/vault/alpha");

    addRecentVault("/vault/beta", fakeWin);
    expect(getLastVaultPath(fakeWin)).toBe("/vault/beta");
  });
});

describe("Tree store search and crawl hardening", () => {
  it("defines MAX_SEARCH_RESULTS bound", () => {
    expect(MAX_SEARCH_RESULTS).toBe(100);
  });

  it("scanVaultMetadata stops immediately when signal is aborted", async () => {
    const mockRepo: Partial<VaultRepository> = {
      listDirectory: vi.fn().mockImplementation(async (_h, dir) => {
        if (dir === "") {
          return [
            {
              path: "sub",
              name: "sub",
              kind: "folder",
              modifiedAt: 0,
              size: 0,
            },
            {
              path: "a.excalidraw",
              name: "a.excalidraw",
              kind: "drawing",
              modifiedAt: 0,
              size: 0,
            },
          ];
        }
        return [
          {
            path: "sub/b.excalidraw",
            name: "b.excalidraw",
            kind: "drawing",
            modifiedAt: 0,
            size: 0,
          },
        ];
      }),
    };

    const controller = new AbortController();
    controller.abort(); // pre-aborted

    const progressSpy = vi.fn();
    const result = await scanVaultMetadata(
      mockRepo as VaultRepository,
      "handle-1",
      controller.signal,
      progressSpy,
    );

    expect(result).toEqual([]);
    expect(progressSpy).not.toHaveBeenCalled();
    expect(mockRepo.listDirectory).not.toHaveBeenCalled();
  });

  it("filters entries case-insensitively for search", () => {
    const entries: VaultEntry[] = [
      {
        path: "Projects/Alpha.excalidraw",
        name: "Alpha.excalidraw",
        kind: "drawing",
        modifiedAt: 0,
        size: 0,
      },
      {
        path: "Personal/Beta.excalidraw",
        name: "Beta.excalidraw",
        kind: "drawing",
        modifiedAt: 0,
        size: 0,
      },
    ];
    const match = searchEntries(entries, "ALPHA");
    expect(match).toHaveLength(1);
    expect(match[0].path).toBe("Projects/Alpha.excalidraw");
  });
});
