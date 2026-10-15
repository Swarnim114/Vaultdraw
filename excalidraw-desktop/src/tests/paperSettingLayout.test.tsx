import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PaperTilePicker } from "../components/paper/PaperTilePicker";
import { SettingRow } from "../components/settings/SettingRow";

describe("SettingRow stacked layout", () => {
  it("puts the aside on the title line and the control on its own line", () => {
    const { container } = render(
      <SettingRow id="paper" layout="stacked" aside={<span>ASIDE</span>}>
        <div data-testid="wide">control</div>
      </SettingRow>,
    );
    const head = container.querySelector(".vault-setting-stacked-head")!;
    expect(head.textContent).toContain("ASIDE");
    expect(head.querySelector(".vault-setting-label")).not.toBeNull();
    expect(
      container.querySelector(".vault-setting-wide [data-testid=wide]"),
    ).not.toBeNull();
    expect(head.contains(screen.getByTestId("wide"))).toBe(false);
  });

  it("keeps the default row layout unchanged", () => {
    const { container } = render(
      <SettingRow id="paper">
        <button type="button">x</button>
      </SettingRow>,
    );
    expect(container.querySelector(".vault-setting-control")).not.toBeNull();
    expect(container.querySelector(".vault-setting-stacked-head")).toBeNull();
  });
});

describe("PaperTilePicker", () => {
  it("shows six tiles and marks the selected one", () => {
    render(<PaperTilePicker value="dots" onChange={vi.fn()} />);
    expect(screen.getAllByRole("button")).toHaveLength(6);
    expect(screen.getByRole("button", { name: "Dots" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Grid" })).not.toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("selects on click", () => {
    const onChange = vi.fn();
    render(<PaperTilePicker value="plain" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Isometric" }));
    expect(onChange).toHaveBeenCalledWith("isometric");
  });

  it("moves selection with arrow keys, wrapping around", () => {
    const onChange = vi.fn();
    render(<PaperTilePicker value="plain" onChange={onChange} />);
    const plain = screen.getByRole("button", { name: "Plain" });
    fireEvent.keyDown(plain, { key: "ArrowRight" });
    expect(onChange).toHaveBeenLastCalledWith("grid");
    fireEvent.keyDown(plain, { key: "ArrowLeft" });
    expect(onChange).toHaveBeenLastCalledWith("isometric");
  });
});
