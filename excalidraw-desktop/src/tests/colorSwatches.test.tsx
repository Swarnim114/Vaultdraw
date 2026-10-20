import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { applyDarkModeFilter } from "@excalidraw/common";

import { ColorSwatches } from "../components/settings/pages/ColorSwatches";

const COLORS = ["#1e1e1e", "#e03131", "transparent"] as const;

const setup = (
  value: string,
  extra: Partial<Parameters<typeof ColorSwatches>[0]> = {},
) => {
  const onChange = vi.fn();
  render(
    <ColorSwatches
      colors={COLORS}
      value={value}
      onChange={onChange}
      swatchLabel={(c) => `Stroke ${c}`}
      customValue="#1e1e1e"
      customTitle="Custom stroke"
      {...extra}
    />,
  );
  return onChange;
};

const checked = () => screen.getAllByRole("radio", { checked: true });

describe("ColorSwatches", () => {
  it("selects exactly the matching preset", () => {
    setup("#E03131");
    expect(checked()).toHaveLength(1);
    expect(checked()[0]).toHaveAccessibleName("Stroke #e03131");
  });

  it("calls onChange when a preset is clicked", () => {
    const onChange = setup("#1e1e1e");
    fireEvent.click(screen.getByLabelText("Stroke transparent"));
    expect(onChange).toHaveBeenCalledWith("transparent");
  });

  it("shows a Default chip only with onClear and selects it for empty value", () => {
    setup("");
    expect(screen.queryByLabelText(/^Default/)).toBeNull();
  });

  it("Default chip selected and clickable", () => {
    const onClear = vi.fn();
    setup("", { onClear });
    expect(checked()).toHaveLength(1);
    expect(checked()[0]).toHaveAccessibleName("Default (theme / app default)");
    fireEvent.click(checked()[0]);
    expect(onClear).toHaveBeenCalled();
  });

  it("marks a non-preset hex as the single selected custom colour", () => {
    setup("#123456");
    expect(screen.queryAllByRole("radio", { checked: true })).toHaveLength(0);
    const input = screen.getByLabelText("Custom stroke") as HTMLInputElement;
    expect(input.value).toBe("#123456");
    expect(input.closest("label")?.className).toContain("--selected");
  });

  it("native custom input reports changes", () => {
    const onChange = setup("#1e1e1e");
    fireEvent.change(screen.getByLabelText("Custom stroke"), {
      target: { value: "#abcdef" },
    });
    expect(onChange).toHaveBeenCalledWith("#abcdef");
  });

  it("validates the hex field; Enter and blur apply", () => {
    const onChange = setup("#1e1e1e", { showHex: true });
    const hex = screen.getByLabelText("Custom stroke (hex)");
    fireEvent.change(hex, { target: { value: "#12" } });
    expect(hex).toHaveAttribute("aria-invalid", "true");
    fireEvent.keyDown(hex, { key: "Enter" });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.change(hex, { target: { value: "#ABCDEF" } });
    fireEvent.keyDown(hex, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith("#abcdef");
    fireEvent.change(hex, { target: { value: "#00ff00" } });
    fireEvent.blur(hex);
    expect(onChange).toHaveBeenLastCalledWith("#00ff00");
  });

  it("moves with arrow keys (wrapping) and selects", () => {
    const onChange = setup("#1e1e1e");
    const first = screen.getByLabelText("Stroke #1e1e1e");
    first.focus();
    fireEvent.keyDown(first, { key: "ArrowRight" });
    expect(onChange).toHaveBeenLastCalledWith("#e03131");
    fireEvent.keyDown(first, { key: "ArrowLeft" });
    expect(onChange).toHaveBeenLastCalledWith("transparent");
  });

  it("uses a roving tabindex on the selected radio", () => {
    setup("#e03131");
    const tabs = screen
      .getAllByRole("radio")
      .map((r) => r.getAttribute("tabindex"));
    expect(tabs).toEqual(["-1", "0", "-1"]);
  });

  describe("canvas display mode", () => {
    const fill = (name: string) =>
      screen.getByLabelText(name).style.getPropertyValue("--vault-swatch");

    it("dark shows the colour as the dark canvas draws it", () => {
      const onChange = setup("#1e1e1e", { canvasTheme: "dark" });
      const shown = applyDarkModeFilter("#1e1e1e", true);
      expect(shown).not.toBe("#1e1e1e");
      expect(fill("Stroke #1e1e1e")).toBe(shown);
      expect(fill("Stroke #e03131")).toBe(applyDarkModeFilter("#e03131", true));
      // value, label and title stay the real colour
      expect(checked()[0]).toHaveAccessibleName("Stroke #1e1e1e");
      expect(screen.getByLabelText("Stroke #1e1e1e").title).toContain(
        "#1e1e1e",
      );
      expect(screen.getByLabelText("Stroke #1e1e1e").title).toContain(
        "dark canvas",
      );
      fireEvent.click(screen.getByLabelText("Stroke #e03131"));
      expect(onChange).toHaveBeenCalledWith("#e03131");
    });

    it("the check mark contrasts with the displayed colour", () => {
      setup("#1e1e1e", { canvasTheme: "dark" });
      // light swatch on the dark canvas -> dark check
      expect(checked()[0]).toHaveClass("vault-cp__swatch--dark");
    });

    it("light and unset modes show the raw colour", () => {
      setup("#1e1e1e", { canvasTheme: "light" });
      expect(fill("Stroke #1e1e1e")).toBe("#1e1e1e");
    });

    it("the custom chip is filtered too", () => {
      setup("#123456", { canvasTheme: "dark" });
      const chip = document.querySelector<HTMLElement>(".vault-cp__custom")!;
      expect(chip.style.getPropertyValue("--vault-swatch")).toBe(
        applyDarkModeFilter("#123456", true),
      );
    });
  });
});
