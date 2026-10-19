import { describe, expect, it, vi } from "vitest";

import { fireEvent, render, screen } from "@testing-library/react";

import GalleryView from "./GalleryView";

import type { VaultEntry } from "../../vault/types";

const entries = (folders: number, drawings: number): VaultEntry[] => [
  ...Array.from({ length: folders }, (_, i) => ({
    path: `sub${i}`,
    name: `sub${i}`,
    kind: "folder" as const,
    modifiedAt: 0,
    size: 0,
  })),
  ...Array.from({ length: drawings }, (_, i) => ({
    path: `d${i}.excalidraw`,
    name: `d${i}.excalidraw`,
    kind: "drawing" as const,
    modifiedAt: 0,
    size: 0,
  })),
];

const setup = (items: VaultEntry[], folder = "") => {
  const h = {
    onOpenDrawing: vi.fn(),
    onOpenFolder: vi.fn(),
    onParent: vi.fn(),
    onClose: vi.fn(),
  };
  render(<GalleryView folder={folder} vaultName="V" items={items} {...h} />);
  return { ...h, grid: screen.getByRole("grid") };
};

describe("<GalleryView>", () => {
  it("mounts only the window for 5k items", () => {
    setup(entries(2, 5000));
    const cells = screen.getAllByRole("gridcell");
    expect(cells.length).toBeLessThanOrEqual(120);
    expect(cells.length).toBeGreaterThan(0);
    expect(screen.getByTestId("gallery-count").textContent).toBe("5002 items");
  });

  it("is focused, has an active descendant and moves it with keys", () => {
    const { grid } = setup(entries(1, 5));
    expect(document.activeElement).toBe(grid);
    expect(grid.getAttribute("aria-activedescendant")).toBe(
      "vd-gallery-tile-0",
    );
    fireEvent.keyDown(grid, { key: "l" });
    expect(grid.getAttribute("aria-activedescendant")).toBe(
      "vd-gallery-tile-1",
    );
  });

  it("Enter opens a drawing, or enters a folder", () => {
    const { grid, onOpenDrawing, onOpenFolder } = setup(entries(1, 3));
    fireEvent.keyDown(grid, { key: "Enter" });
    expect(onOpenFolder).toHaveBeenCalledWith("sub0");
    fireEvent.keyDown(grid, { key: "ArrowRight" });
    fireEvent.keyDown(grid, { key: "Enter" });
    expect(onOpenDrawing).toHaveBeenCalledWith("d0.excalidraw");
  });

  it("Backspace goes to the parent, Escape closes, click opens", () => {
    const { grid, onParent, onClose, onOpenDrawing } = setup(
      entries(0, 3),
      "a",
    );
    fireEvent.keyDown(grid, { key: "Backspace" });
    expect(onParent).toHaveBeenCalled();
    fireEvent.keyDown(grid, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
    fireEvent.click(screen.getAllByRole("gridcell")[2]);
    expect(onOpenDrawing).toHaveBeenCalledWith("d2.excalidraw");
  });

  it("without a thumbnail service tiles show placeholders and no img", () => {
    setup(entries(1, 3));
    expect(document.querySelectorAll("img").length).toBe(0);
    expect(document.querySelectorAll(".vault-thumb--placeholder").length).toBe(
      4,
    );
  });
});
