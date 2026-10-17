import { describe, expect, it, vi } from "vitest";

import { COMMANDS, getCommand } from "./commands";
import { appCommandHandlers } from "./useAppCommands";

describe("Import: PDF command", () => {
  it("is registered once in File, rebindable, needs a writable open drawing", () => {
    const command = getCommand("file.importPdf");
    expect(command).toMatchObject({
      title: "Import: PDF…",
      category: "File",
      when: ["drawingOpen", "writable"],
    });
    expect(command?.keys.default).toEqual([]);
    expect(COMMANDS.filter((c) => c.id === "file.importPdf")).toHaveLength(1);
  });

  it("starts the import flow", () => {
    const importPdf = vi.fn();
    const handlers = appCommandHandlers({ importPdf } as never);
    handlers["file.importPdf"]!();
    expect(importPdf).toHaveBeenCalledOnce();
  });
});
