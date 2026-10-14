import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createBackgroundPattern,
  BACKGROUND_PATTERN_LIMITS,
} from "@excalidraw/excalidraw/data/backgroundPattern";

import { PaperControls } from "../components/paper/PaperControls";
import { PaperPreview } from "../components/paper/PaperPreview";
import {
  getDefaultBackgroundPattern,
  setDefaultBackgroundPattern,
} from "../vault/paperDefaults";

describe("PaperControls", () => {
  beforeEach(() => {
    window.localStorage.clear();
    setDefaultBackgroundPattern(null);
  });

  it("offers the six styles and switches to the preset", () => {
    const onChange = vi.fn();
    render(<PaperControls value={null} onChange={onChange} />);
    expect(screen.getAllByRole("radio")).toHaveLength(6);
    expect(screen.getByLabelText("Plain")).toBeChecked();
    fireEvent.click(screen.getByLabelText("Graph"));
    expect(onChange).toHaveBeenCalledWith(createBackgroundPattern("graph"));
  });

  it("starts from the tuned app default when its style is chosen", () => {
    setDefaultBackgroundPattern(
      createBackgroundPattern("dots", { spacing: 33 }),
    );
    const onChange = vi.fn();
    render(<PaperControls value={null} onChange={onChange} />);
    fireEvent.click(screen.getByLabelText("Dots"));
    expect(onChange).toHaveBeenCalledWith(getDefaultBackgroundPattern());
    expect(onChange.mock.calls[0][0].spacing).toBe(33);
  });

  it("selecting plain gives null and hides parameters", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <PaperControls
        value={createBackgroundPattern("grid")}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByLabelText("Plain"));
    expect(onChange).toHaveBeenCalledWith(null);
    rerender(<PaperControls value={null} onChange={onChange} />);
    expect(screen.queryByLabelText("Spacing")).toBeNull();
  });

  it("shows only the parameters relevant to the style", () => {
    const { rerender } = render(
      <PaperControls
        value={createBackgroundPattern("grid")}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("Spacing")).toBeInTheDocument();
    expect(screen.getByLabelText("Major line every")).toBeInTheDocument();
    expect(screen.queryByLabelText("Margin line")).toBeNull();
    rerender(
      <PaperControls
        value={createBackgroundPattern("lines")}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("Margin line")).toBeInTheDocument();
    expect(screen.queryByLabelText("Major line every")).toBeNull();
    rerender(
      <PaperControls
        value={createBackgroundPattern("dots")}
        onChange={vi.fn()}
      />,
    );
    expect(screen.queryByLabelText("Margin line")).toBeNull();
    expect(screen.queryByLabelText("Major line every")).toBeNull();
  });

  it("clamps numbers and normalizes colour", () => {
    const onChange = vi.fn();
    render(
      <PaperControls
        value={createBackgroundPattern("grid")}
        onChange={onChange}
      />,
    );
    fireEvent.change(screen.getByLabelText("Spacing"), {
      target: { value: "9999" },
    });
    fireEvent.blur(screen.getByLabelText("Spacing"));
    expect(onChange.mock.calls[0][0].spacing).toBe(
      BACKGROUND_PATTERN_LIMITS.spacing.max,
    );
    fireEvent.change(screen.getByLabelText("Opacity"), {
      target: { value: "1" },
    });
    fireEvent.blur(screen.getByLabelText("Opacity"));
    expect(onChange.mock.calls[1][0].opacity).toBe(
      BACKGROUND_PATTERN_LIMITS.opacity.min,
    );
    fireEvent.click(screen.getByLabelText("Auto"));
    expect(onChange.mock.calls[2][0].color).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("does not clamp per keystroke; commits on blur and reverts on Escape", () => {
    const onChange = vi.fn();
    render(
      <PaperControls
        value={createBackgroundPattern("grid")}
        onChange={onChange}
      />,
    );
    const input = screen.getByLabelText("Spacing") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "3" } });
    expect(onChange).not.toHaveBeenCalled();
    expect(input.value).toBe("3");
    fireEvent.change(input, { target: { value: "30" } });
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ spacing: 30 }),
    );
    fireEvent.change(input, { target: { value: "3" } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        spacing: BACKGROUND_PATTERN_LIMITS.spacing.min,
      }),
    );
    onChange.mockClear();
    fireEvent.change(input, { target: { value: "3" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(input.value).toBe("20");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("hideStyle omits the picker", () => {
    render(
      <PaperControls
        hideStyle
        value={createBackgroundPattern("grid")}
        onChange={vi.fn()}
      />,
    );
    expect(screen.queryAllByRole("radio")).toHaveLength(0);
  });
});

describe("PaperPreview", () => {
  it("renders an accessible canvas without throwing", () => {
    render(
      <PaperPreview pattern={createBackgroundPattern("lines")} theme="dark" />,
    );
    expect(screen.getByRole("img")).toHaveAttribute(
      "aria-label",
      "Paper preview: lines",
    );
  });
});
