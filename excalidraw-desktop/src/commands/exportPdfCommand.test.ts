import { describe, expect, it, vi } from "vitest";

import { COMMANDS, getCommand } from "./commands";
import { appCommandHandlers } from "./useAppCommands";

describe("Export: PDF command", () => {
  it("is registered in the Export category, rebindable, needs an open drawing", () => {
    const command = getCommand("file.exportPdf");
    expect(command).toMatchObject({
      title: "Export: PDF",
      category: "Export",
      when: ["drawingOpen"],
    });
    expect(command?.keys.default).toEqual([]);
    expect(COMMANDS.filter((c) => c.id === "file.exportPdf")).toHaveLength(1);
  });

  it("exports the open drawing as pdf", () => {
    const exportActive = vi.fn();
    const handlers = appCommandHandlers({ exportActive } as never);
    handlers["file.exportPdf"]!();
    expect(exportActive).toHaveBeenCalledWith("pdf");
  });
});
