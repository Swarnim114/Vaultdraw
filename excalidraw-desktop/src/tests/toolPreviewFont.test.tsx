import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
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
