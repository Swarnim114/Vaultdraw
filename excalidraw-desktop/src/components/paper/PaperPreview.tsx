import { useEffect, useRef } from "react";

import { applyDarkModeFilter } from "@excalidraw/common";
import { renderBackgroundPattern } from "@excalidraw/excalidraw/renderer/backgroundPattern";

import type { BackgroundPattern } from "@excalidraw/excalidraw/data/backgroundPattern";

import "./paper.css";

type Props = {
  pattern: BackgroundPattern | null;
  theme: "light" | "dark";
  width?: number;
  height?: number;
};

// Scene origin offset: keeps the ruled-paper margin line (scene x = 80) in view.
const SCROLL_X = -16;
const SCROLL_Y = -12;

/** A small sample of the paper, drawn like the canvas (zoom 1). */
export const PaperPreview = ({
  pattern,
  theme,
  width = 220,
  height = 120,
}: Props) => {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) {
      return;
    }
    const scale = canvas.ownerDocument.defaultView?.devicePixelRatio || 1;
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    const dark = theme === "dark";
    context.fillStyle = dark ? applyDarkModeFilter("#ffffff") : "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    if (pattern) {
      renderBackgroundPattern(context, pattern, {
        scrollX: SCROLL_X,
        scrollY: SCROLL_Y,
        zoom: 1,
        scale,
        width: canvas.width,
        height: canvas.height,
        isDarkMode: dark,
      });
    }
  }, [pattern, theme, width, height]);

  return (
    <canvas
      ref={ref}
      className="paper-preview"
      style={{ width, height }}
      role="img"
      aria-label={
        pattern ? `Paper preview: ${pattern.type}` : "Paper preview: plain"
      }
    />
  );
};
