import { describe, expect, it, vi } from "vitest";

import { createGlobalTemplateStore } from "./globalTemplates";

describe("global template store", () => {
  it("memory store lists, reads, and refuses overwrite", async () => {
    const store = createGlobalTemplateStore({ tauri: false });
    expect(await store.list()).toEqual([]);
    await store.write("A.excalidraw", "{}");
    expect(await store.read("A.excalidraw")).toBe("{}");
    expect((await store.list())[0]).toMatchObject({
      name: "A.excalidraw",
      size: 2,
    });
    await expect(store.write("A.excalidraw", "x")).rejects.toMatchObject({
      code: "NAME_COLLISION",
    });
    await expect(store.read("B.excalidraw")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(store.reveal()).resolves.toBeUndefined();
  });

  it("native store calls the Tauri commands", async () => {
    const invoke = vi.fn(async (cmd: string) =>
      cmd === "read_global_template" ? { json: "J", revision: "r" } : [],
    );
    const store = createGlobalTemplateStore({
      tauri: true,
      invoke: invoke as never,
    });
    await store.list();
    expect(await store.read("A.excalidraw")).toBe("J");
    await store.write("A.excalidraw", "J");
    await store.reveal();
    expect(invoke.mock.calls).toEqual([
      ["list_global_templates", undefined],
      ["read_global_template", { name: "A.excalidraw" }],
      ["write_global_template", { name: "A.excalidraw", json: "J" }],
      ["open_global_templates_dir", undefined],
    ]);
  });

  it("native errors keep their code", async () => {
    const invoke = vi.fn(async () => {
      throw Object.assign(new Error("exists"), { code: "NAME_COLLISION" });
    });
    const store = createGlobalTemplateStore({
      tauri: true,
      invoke: invoke as never,
    });
    await expect(store.write("A.excalidraw", "{}")).rejects.toMatchObject({
      code: "NAME_COLLISION",
    });
  });
});
