import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { applyDarkModeFilter } from "@excalidraw/common";

import {
  CANVAS_COLOUR_NOTE,
  ToolStylePreview,
  type PreviewFallback,
} from "../components/settings/pages/ToolPreview";

const fallback = (fontFamily: number): PreviewFallback => ({
  strokeColor: "#000",
  backgroundColor: "transparent",
  fillStyle: "solid",
  strokeWidth: 2,
  roughness: 1,
  fontFamily,
  fontSize: 20,
});

const fontOf = () =>
  (screen.getByText("Sample text") as unknown as SVGElement).style.fontFamily;

describe("text preview font", () => {
  it("uses the configured default font's real name", () => {
    render(<ToolStylePreview tool="text" style={{}} fallback={fallback(6)} />);
    expect(fontOf()).toContain("Nunito");
  });

  it("shows Excalifont when the default is 5", () => {
    render(<ToolStylePreview tool="text" style={{}} fallback={fallback(5)} />);
    expect(fontOf()).toContain("Excalifont");
  });

  it("prefers the tool's own font over the default", () => {
    render(
      <ToolStylePreview
        tool="text"
        style={{ font_family: 3 }}
        fallback={fallback(5)}
      />,
    );
    expect(fontOf()).toContain("Cascadia");
  });
});

describe("text preview Assistant", () => {
  it("uses the Assistant UI face for id 10 and asks the browser to load it", () => {
    const load = vi.fn().mockResolvedValue([]);
    const fonts = document.fonts as unknown as { load: unknown };
    fonts.load = load;
    render(<ToolStylePreview tool="text" style={{}} fallback={fallback(10)} />);
    expect(fontOf()).toContain("Assistant");
    expect(load).toHaveBeenCalledWith("16px Assistant");
  });
});

describe("preview colours follow the canvas theme", () => {
  const black = { ...fallback(5), strokeColor: "#1e1e1e" };

  it("dark: text uses the filtered colour, no CSS filter, dark canvas box", () => {
    render(
      <ToolStylePreview tool="text" style={{}} fallback={black} theme="dark" />,
    );
    const text = screen.getByText("Sample text");
    expect(text.getAttribute("fill")).toBe(
      applyDarkModeFilter("#1e1e1e", true),
    );
    const box = screen.getByTestId("tool-preview-text");
    expect(box.style.filter).toBe("");
    expect(box.style.backgroundColor).not.toBe("");
    expect(box.style.backgroundColor).not.toBe("rgb(255, 255, 255)");
    expect(screen.getByText(CANVAS_COLOUR_NOTE)).toBeTruthy();
  });

  it("light: raw colour, white box, no note", () => {
    render(<ToolStylePreview tool="text" style={{}} fallback={black} />);
    expect(screen.getByText("Sample text").getAttribute("fill")).toBe(
      "#1e1e1e",
    );
    expect(screen.queryByText(CANVAS_COLOUR_NOTE)).toBeNull();
  });
});
