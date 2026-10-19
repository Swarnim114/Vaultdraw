import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ThumbnailProvider } from "../context";

import { RecentDrawings } from "./RecentDrawings";

import type { ThumbnailService } from "../service";

const entries = [
  { path: "A/One.excalidraw", name: "One", folder: "A" },
  { path: "Two.excalidraw", name: "Two", folder: "V" },
];

const service = {
  watch: vi.fn(() => () => {}),
} as unknown as ThumbnailService;

describe("RecentDrawings", () => {
  it("renders the plain text rows without a thumbnail service", () => {
    const { container } = render(
      <RecentDrawings entries={entries} onOpen={() => {}} />,
    );
    expect(screen.getByLabelText("Recent drawings")).toBeTruthy();
    expect(
      container.querySelectorAll("button.vault-recent__item"),
    ).toHaveLength(2);
    expect(container.querySelector(".vault-thumb")).toBeNull();
    expect(screen.getByText("One")).toBeTruthy();
    expect(screen.getByText("V")).toBeTruthy();
  });

  it("renders a thumbnail per tile with a service", () => {
    const onOpen = vi.fn();
    const { container } = render(
      <ThumbnailProvider service={service}>
        <RecentDrawings entries={entries} onOpen={onOpen} />
      </ThumbnailProvider>,
    );
    expect(container.querySelectorAll(".vault-thumb--md")).toHaveLength(2);
    (
      container.querySelector("button.vault-recent__item") as HTMLElement
    ).click();
    expect(onOpen).toHaveBeenCalledWith("A/One.excalidraw");
  });
});
