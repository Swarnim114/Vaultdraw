/**
 * Live previews for the Tools page: a small SVG sample drawn with the chosen
 * style (shape, line, arrow, text, pen stroke, laser trail). Purely visual,
 * so it is hidden from assistive tech; the rows carry the values.
 *
 * Drawn on a "canvas" box. In dark mode every colour goes through
 * applyDarkModeFilter and the box takes the canvas background, exactly as the
 * editor draws them (including a synced theme's colours), so the preview
 * agrees with the swatches and with the real canvas.
 */
import { useEffect, useId, type ReactNode } from "react";

import {
  applyCanvasBackgroundFilter,
  applyDarkModeFilter,
  FONT_FAMILY,
  getFontFamilyString,
} from "@excalidraw/common";
import { Fonts } from "@excalidraw/excalidraw";

import type { ExcalidrawElement } from "@excalidraw/element/types";

import type { StyledTool, ToolStyle } from "../../../toolDefaults/toolStyles";

const W = 240;
const H = 72;

/** Editor values used where a key is unset ("Default"). */
export interface PreviewFallback {
  strokeColor: string;
  backgroundColor: string;
  fillStyle: string;
  strokeWidth: number;
  roughness: number;
  fontFamily: number;
  fontSize: number;
}

const SAMPLE_TEXT = "Sample text";

/** Shown once under a preview in dark mode. */
export const CANVAS_COLOUR_NOTE =
  "Dark mode: colours are shown as they appear on the dark canvas.";

/**
 * Excalidraw registers its fonts lazily and loads a face only when a scene
 * text uses it, so the effective default font may not be loaded while the
 * settings dialog is open (the browser then shows its fallback). Load it.
 */
const useLoadedFont = (fontFamily: number | null) => {
  useEffect(() => {
    if (
      fontFamily === null ||
      typeof document === "undefined" ||
      !document.fonts
    ) {
      return;
    }
    if (fontFamily === FONT_FAMILY.Assistant) {
      // Assistant is the UI face (fonts.css), not a registered scene font.
      document.fonts.load("16px Assistant").catch(() => {});
      return;
    }
    const sample = { type: "text", fontFamily, text: SAMPLE_TEXT };
    Fonts.loadElementsFonts([sample as unknown as ExcalidrawElement]).catch(
      () => {},
    );
  }, [fontFamily]);
};

const clamp = (v: number, min: number, max: number) =>
  Math.min(max, Math.max(min, v));

const dash = (style: string | undefined, width: number) =>
  style === "dashed"
    ? `8 ${8 + width}`
    : style === "dotted"
    ? `1.5 ${6 + width}`
    : undefined;

export type CanvasTheme = "light" | "dark";

/** A colour as the canvas draws it in this theme. */
const onCanvas = (color: string, theme: CanvasTheme) =>
  color === "transparent" || color === "none"
    ? color
    : applyDarkModeFilter(color, theme === "dark");

const PreviewBox = ({
  children,
  testId,
  theme,
}: {
  children: ReactNode;
  testId?: string;
  theme: CanvasTheme;
}) => (
  <>
    <div
      className="vault-tools-preview"
      data-testid={testId}
      aria-hidden="true"
      style={{
        backgroundColor: applyCanvasBackgroundFilter(
          "#ffffff",
          theme === "dark",
        ),
      }}
    >
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        height={H}
        preserveAspectRatio="xMidYMid meet"
      >
        {children}
      </svg>
    </div>
    {theme === "dark" && (
      <p className="vault-tools-preview-note">{CANVAS_COLOUR_NOTE}</p>
    )}
  </>
);

/** Hand-drawn wobble for sloppiness 1 and 2 (0 = clean lines). */
const RoughFilter = ({ id, roughness }: { id: string; roughness: number }) =>
  roughness > 0 ? (
    <filter id={id} x="-10%" y="-10%" width="120%" height="120%">
      <feTurbulence
        type="fractalNoise"
        baseFrequency="0.02"
        numOctaves="1"
        seed="3"
      />
      <feDisplacementMap in="SourceGraphic" scale={roughness * 1.5} />
    </filter>
  ) : null;

/** Hachure / cross-hatch / zigzag as a line pattern in the fill colour. */
const FillPattern = ({
  id,
  fillStyle,
  color,
}: {
  id: string;
  fillStyle: string;
  color: string;
}) => (
  <pattern
    id={id}
    width="8"
    height="8"
    patternUnits="userSpaceOnUse"
    patternTransform="rotate(-45)"
  >
    <line x1="0" y1="4" x2="8" y2="4" stroke={color} strokeWidth="1.5" />
    {fillStyle === "cross-hatch" && (
      <line x1="4" y1="0" x2="4" y2="8" stroke={color} strokeWidth="1.5" />
    )}
  </pattern>
);

type Head = string;

/** An arrowhead with its tip at (0,0), pointing along +x, size s. */
const headShape = (
  head: Head,
  s: number,
  color: string,
  paper: string,
): ReactNode => {
  const outline = head.endsWith("_outline");
  const fill = outline ? paper : color;
  const bar = (x: number) => <line x1={x} y1={-s * 0.6} x2={x} y2={s * 0.6} />;
  const crow = (
    <path d={`M${-s} 0L0 ${-s * 0.6}M${-s} 0L0 0M${-s} 0L0 ${s * 0.6}`} />
  );
  switch (head) {
    case "arrow":
      return <path d={`M${-s} ${-s * 0.55}L0 0L${-s} ${s * 0.55}`} />;
    case "bar":
      return bar(0);
    case "triangle":
    case "triangle_outline":
      return (
        <path d={`M0 0L${-s} ${-s * 0.5}L${-s} ${s * 0.5}Z`} fill={fill} />
      );
    case "circle":
    case "circle_outline":
      return <circle cx={-s * 0.45} cy="0" r={s * 0.45} fill={fill} />;
    case "diamond":
    case "diamond_outline":
      return (
        <path
          d={`M0 0L${-s * 0.55} ${-s * 0.4}L${-s * 1.1} 0L${-s * 0.55} ${
            s * 0.4
          }Z`}
          fill={fill}
        />
      );
    case "cardinality_one":
      return bar(-s * 0.5);
    case "cardinality_many":
      return crow;
    case "cardinality_one_or_many":
      return (
        <>
          {crow}
          {bar(-s * 1.2)}
        </>
      );
    case "cardinality_exactly_one":
      return (
        <>
          {bar(-s * 0.4)}
          {bar(-s * 0.8)}
        </>
      );
    case "cardinality_zero_or_one":
      return (
        <>
          {bar(-s * 0.4)}
          <circle cx={-s * 1.1} cy="0" r={s * 0.35} fill={paper} />
        </>
      );
    case "cardinality_zero_or_many":
      return (
        <>
          {crow}
          <circle cx={-s * 1.4} cy="0" r={s * 0.35} fill={paper} />
        </>
      );
    default:
      return null;
  }
};

const ArrowHead = ({
  head,
  x,
  y,
  angle,
  size,
  color,
  paper,
}: {
  head: Head;
  x: number;
  y: number;
  angle: number;
  size: number;
  color: string;
  paper: string;
}) =>
  head === "none" ? null : (
    <g
      transform={`translate(${x} ${y}) rotate(${(angle * 180) / Math.PI})`}
      strokeDasharray="none"
    >
      {headShape(head, size, color, paper)}
    </g>
  );

/** Path plus the tangent angles at its two ends (for the heads). */
const arrowGeometry = (type: string | undefined) => {
  if (type === "elbow") {
    return {
      d: "M40 54H120V18H200",
      start: { x: 40, y: 54, angle: Math.PI },
      end: { x: 200, y: 18, angle: 0 },
    };
  }
  if (type === "round") {
    return {
      d: "M40 54Q120 -6 200 40",
      start: { x: 40, y: 54, angle: Math.atan2(54 + 6, 40 - 120) },
      end: { x: 200, y: 40, angle: Math.atan2(40 + 6, 200 - 120) },
    };
  }
  const angle = Math.atan2(18 - 54, 200 - 40);
  return {
    d: "M40 54L200 18",
    start: { x: 40, y: 54, angle: angle + Math.PI },
    end: { x: 200, y: 18, angle },
  };
};

const SHAPES: Partial<Record<StyledTool, (round: boolean) => ReactNode>> = {
  rectangle: (round) => (
    <rect x="76" y="12" width="88" height="48" rx={round ? 12 : 0} />
  ),
  diamond: (round) => (
    <path
      d="M120 6L170 36L120 66L70 36Z"
      strokeLinejoin={round ? "round" : "miter"}
    />
  ),
  ellipse: () => <ellipse cx="120" cy="36" rx="50" ry="28" />,
  line: (round) => (
    <path
      d={
        round
          ? "M36 54C70 54 80 16 120 16S170 54 204 22"
          : "M36 54L96 18L150 50L204 20"
      }
      fill="none"
    />
  ),
};

/** Preview of a styled tool's default style. */
export const ToolStylePreview = ({
  tool,
  style,
  fallback,
  theme = "light",
}: {
  tool: StyledTool;
  style: ToolStyle;
  fallback: PreviewFallback;
  theme?: CanvasTheme;
}) => {
  const uid = useId().replace(/:/g, "");
  const stroke = onCanvas(style.stroke_color ?? fallback.strokeColor, theme);
  const paper = applyCanvasBackgroundFilter("#ffffff", theme === "dark");
  const opacity = (style.opacity ?? 100) / 100;
  const testId = `tool-preview-${tool}`;
  const fontFamily = style.font_family ?? fallback.fontFamily;
  useLoadedFont(tool === "text" ? fontFamily : null);

  if (tool === "text") {
    const align = style.text_align ?? "left";
    const x = align === "center" ? W / 2 : align === "right" ? W - 14 : 14;
    const size = clamp(style.font_size ?? fallback.fontSize, 10, 40);
    return (
      <PreviewBox testId={testId} theme={theme}>
        <text
          x={x}
          y={H / 2}
          dominantBaseline="central"
          textAnchor={
            align === "center" ? "middle" : align === "right" ? "end" : "start"
          }
          fill={stroke}
          opacity={opacity}
          style={{
            fontFamily: getFontFamilyString({ fontFamily }),
            fontSize: size,
          }}
        >
          {SAMPLE_TEXT}
        </text>
      </PreviewBox>
    );
  }

  const width = clamp(style.stroke_width ?? fallback.strokeWidth, 0.5, 12);
  const roughness = style.roughness ?? fallback.roughness;
  const filterId = `rough-${uid}`;
  const common = {
    stroke,
    strokeWidth: width,
    strokeDasharray: dash(style.stroke_style, width),
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    filter: roughness > 0 ? `url(#${filterId})` : undefined,
  };

  if (tool === "arrow") {
    const geo = arrowGeometry(style.arrow_type);
    const size = 9 + width * 1.5;
    return (
      <PreviewBox testId={testId} theme={theme}>
        <defs>
          <RoughFilter id={filterId} roughness={roughness} />
        </defs>
        <g {...common} fill="none" opacity={opacity}>
          <path d={geo.d} />
          <ArrowHead
            head={style.start_arrowhead ?? "none"}
            {...geo.start}
            size={size}
            color={stroke}
            paper={paper}
          />
          <ArrowHead
            head={style.end_arrowhead ?? "arrow"}
            {...geo.end}
            size={size}
            color={stroke}
            paper={paper}
          />
        </g>
      </PreviewBox>
    );
  }

  const background = onCanvas(
    style.background_color ?? fallback.backgroundColor,
    theme,
  );
  const fillStyle = style.fill_style ?? fallback.fillStyle;
  const patternId = `fill-${uid}`;
  const hasFill = tool !== "line" && background !== "transparent";
  const fill = !hasFill
    ? "none"
    : fillStyle === "solid"
    ? background
    : `url(#${patternId})`;
  return (
    <PreviewBox testId={testId} theme={theme}>
      <defs>
        <RoughFilter id={filterId} roughness={roughness} />
        {hasFill && fillStyle !== "solid" && (
          <FillPattern
            id={patternId}
            fillStyle={fillStyle}
            color={background}
          />
        )}
      </defs>
      <g {...common} fill={fill} opacity={opacity}>
        {SHAPES[tool]?.((style.roundness ?? "round") === "round")}
      </g>
    </PreviewBox>
  );
};

const PEN_PATH = (t: number) => ({
  x: 24 + t * 192,
  y: 36 + Math.sin(t * Math.PI * 2.2) * 18 * (1 - t * 0.3),
});

/** A freehand stroke: tapered when the pen uses pressure. */
export const PenPreview = ({
  color,
  width,
  opacity,
  pressure,
  highlighter,
  theme = "light",
}: {
  color: string;
  width: number;
  opacity: number;
  pressure: boolean;
  highlighter: boolean;
  theme?: CanvasTheme;
}) => {
  const steps = 48;
  const w = clamp(width * 2, 1, highlighter ? 24 : 16);
  const segments = Array.from({ length: steps }, (_, i) => {
    const a = PEN_PATH(i / steps);
    const b = PEN_PATH((i + 1) / steps);
    const t = (i + 0.5) / steps;
    const sw = pressure ? w * (0.35 + 0.65 * Math.sin(Math.PI * t)) : w;
    return (
      <line
        // eslint-disable-next-line react/no-array-index-key
        key={i}
        x1={a.x}
        y1={a.y}
        x2={b.x}
        y2={b.y}
        strokeWidth={sw}
      />
    );
  });
  return (
    <PreviewBox testId="tool-preview-pen" theme={theme}>
      {highlighter && (
        <text
          x={W / 2}
          y={H / 2}
          dominantBaseline="central"
          textAnchor="middle"
          fill={onCanvas("#868e96", theme)}
          style={{ fontSize: 15 }}
        >
          Highlighted notes go behind
        </text>
      )}
      <g
        stroke={onCanvas(color, theme)}
        strokeLinecap="round"
        opacity={opacity / 100}
        style={highlighter ? { mixBlendMode: "multiply" } : undefined}
      >
        {segments}
      </g>
    </PreviewBox>
  );
};

/** A laser trail that tapers and fades towards its tail. */
export const LaserPreview = ({
  color,
  size,
  length,
  theme = "light",
}: {
  color: string;
  size: number;
  length: number;
  /** The laser is not theme-filtered on the canvas; only the box changes. */
  theme?: CanvasTheme;
}) => {
  const steps = 40;
  // Longer tails cover more of the sample path (5..200 -> 25%..100%).
  const span = 0.25 + 0.75 * clamp((length - 5) / 195, 0, 1);
  const point = (t: number) => ({
    x: 30 + t * 180,
    y: 40 - Math.sin(t * Math.PI) * 22 + Math.sin(t * 9) * 4,
  });
  const segments = Array.from({ length: steps }, (_, i) => {
    const t0 = 1 - span + (span * i) / steps;
    const t1 = 1 - span + (span * (i + 1)) / steps;
    const a = point(t0);
    const b = point(t1);
    const k = (i + 1) / steps;
    return (
      <line
        // eslint-disable-next-line react/no-array-index-key
        key={i}
        x1={a.x}
        y1={a.y}
        x2={b.x}
        y2={b.y}
        strokeWidth={Math.max(0.5, size * 1.5 * k)}
        opacity={0.15 + 0.85 * k}
      />
    );
  });
  const tip = point(1);
  return (
    <PreviewBox testId="tool-preview-laser" theme={theme}>
      <g stroke={color} strokeLinecap="round">
        {segments}
      </g>
      <circle cx={tip.x} cy={tip.y} r={Math.max(1.5, size)} fill={color} />
    </PreviewBox>
  );
};
