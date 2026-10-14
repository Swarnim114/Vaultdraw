import { describe, expect, it } from "vitest";

import { FakeVaultRepository } from "../tests/fakeVaultRepository";

import { createGlobalTemplateStore } from "./globalTemplates";
import {
  isInTemplatesFolder,
  listTemplates,
  readTemplateJson,
} from "./listTemplates";

const setup = () => {
  const repository = new FakeVaultRepository();
  const global = createGlobalTemplateStore({ tauri: false });
  return { repository, handle: repository.handle, folder: "Templates", global };
};

describe("listTemplates", () => {
  it("treats a missing folder as empty", async () => {
    const deps = setup();
    expect(await listTemplates(deps)).toEqual({ vault: [], global: [] });
  });

  it("lists drawings only, sorted case-insensitively, plus global", async () => {
    const deps = setup();
    deps.repository.seedDrawing("Templates/b.excalidraw", "{}");
    deps.repository.seedDrawing("Templates/A.excalidraw", "{}");
    deps.repository.seedDrawing("Templates/sub/deep.excalidraw", "{}");
    await deps.global.write("Z.excalidraw", "{}");
    const res = await listTemplates(deps);
    expect(res.vault.map((e) => e.name)).toEqual(["A", "b"]);
    expect(res.vault[0]).toMatchObject({
      source: "vault",
      path: "Templates/A.excalidraw",
    });
    expect(res.global).toMatchObject([
      { source: "global", path: "Z.excalidraw", name: "Z" },
    ]);
  });

  it("reports a vault failure without losing global templates", async () => {
    const deps = setup();
    await deps.global.write("Z.excalidraw", "{}");
    deps.repository.listDirectory = async () => {
      throw new Error("boom");
    };
    const res = await listTemplates(deps);
    expect(res.vaultError).toBe("boom");
    expect(res.vault).toEqual([]);
    expect(res.global).toHaveLength(1);
  });

  it("reads from either source", async () => {
    const deps = setup();
    deps.repository.seedDrawing("Templates/A.excalidraw", "VAULT");
    await deps.global.write("G.excalidraw", "GLOBAL");
    const { vault, global } = await listTemplates(deps);
    expect(await readTemplateJson(vault[0], deps)).toBe("VAULT");
    expect(await readTemplateJson(global[0], deps)).toBe("GLOBAL");
  });
});

describe("isInTemplatesFolder", () => {
  it("matches the folder and its descendants only", () => {
    expect(isInTemplatesFolder("Templates", "Templates")).toBe(true);
    expect(isInTemplatesFolder("Templates/a.excalidraw", "Templates")).toBe(
      true,
    );
    expect(isInTemplatesFolder("Templates2/a.excalidraw", "Templates")).toBe(
      false,
    );
    expect(isInTemplatesFolder("templates/a.excalidraw", "Templates")).toBe(
      false,
    );
    expect(isInTemplatesFolder("a.excalidraw", "")).toBe(false);
  });
});
