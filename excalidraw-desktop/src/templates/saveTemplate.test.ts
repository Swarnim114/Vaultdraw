import { describe, expect, it } from "vitest";

import { FakeVaultRepository } from "../tests/fakeVaultRepository";

import { createGlobalTemplateStore } from "./globalTemplates";
import { saveAsTemplate } from "./saveTemplate";

const setup = () => {
  const repository = new FakeVaultRepository();
  const global = createGlobalTemplateStore({ tauri: false });
  return { repository, handle: repository.handle, folder: "Templates", global };
};

describe("saveAsTemplate", () => {
  it("creates the folder and writes into the vault", async () => {
    const deps = setup();
    const entry = await saveAsTemplate({
      ...deps,
      scope: "vault",
      name: "Lecture.excalidraw",
      json: "{}",
    });
    expect(entry).toMatchObject({
      source: "vault",
      path: "Templates/Lecture.excalidraw",
      name: "Lecture",
    });
    expect(
      (await deps.repository.readDrawing(deps.handle, entry.path)).json,
    ).toBe("{}");
    expect(deps.repository.writeCalls.at(-1)?.expectedRevision).toBeNull();
  });

  it("picks a unique name instead of overwriting", async () => {
    const deps = setup();
    const save = () =>
      saveAsTemplate({ ...deps, scope: "vault", name: "Plan", json: "{}" });
    await save();
    expect((await save()).name).toBe("Plan 2");
    expect((await save()).path).toBe("Templates/Plan 3.excalidraw");
  });

  it("writes global templates through the store", async () => {
    const deps = setup();
    await saveAsTemplate({ ...deps, scope: "global", name: "G", json: "{}" });
    const second = await saveAsTemplate({
      ...deps,
      scope: "global",
      name: "g",
      json: "{}",
    });
    expect(second).toMatchObject({ source: "global", path: "g 2.excalidraw" });
    expect((await deps.global.list()).map((e) => e.name).sort()).toEqual([
      "G.excalidraw",
      "g 2.excalidraw",
    ]);
  });

  it("rejects invalid names", async () => {
    const deps = setup();
    await expect(
      saveAsTemplate({ ...deps, scope: "vault", name: "a/b", json: "{}" }),
    ).rejects.toThrow();
    await expect(
      saveAsTemplate({ ...deps, scope: "vault", name: "  ", json: "{}" }),
    ).rejects.toThrow();
  });
});
