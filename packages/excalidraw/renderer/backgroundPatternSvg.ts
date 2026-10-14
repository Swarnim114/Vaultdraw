/**
 * SVG export of notebook backgrounds: one `<pattern>` in defs plus a rect
 * filled with it, anchored to scene coordinates through the export offset.
 * Same level-of-detail rule as the canvas, evaluated at zoom 1.
 */

import { applyDarkModeFilter } from "@excalidraw/common";

import {
  PATTERN_MARGIN_X,
  backgroundPatternKey,
  getIsometricRowHeight,
  getPatternColors,
  getPatternDotRadiusPx,
  hasMajorLines,
  patternLevelAlpha,
} from "../data/backgroundPattern";

import type { BackgroundPattern } from "../data/backgroundPattern";

const SVG_NS = "http://www.w3.org/2000/svg";

const n = (value: number) => `${Math.round(value * 1000) / 1000}`;

const mod = (value: number, divisor: number) =>
  ((value % divisor) + divisor) % divisor;

/** Short deterministic id: the same pattern + offset always gets the same. */
const patternId = (key: string) => {
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (Math.imul(hash, 31) + key.charCodeAt(i)) >>> 0;
  }
  return `bg-pattern-${hash.toString(36)}`;
};

/** `H`/`V` segments at each position (plus the tile edges) in a tile. */
const linePath = (positions: number[], tileSize: number) => {
  let d = "";
  for (const position of positions) {
    d += `M${n(position)} 0V${n(tileSize)}M0 ${n(position)}H${n(tileSize)}`;
  }
  return d;
};

export const appendBackgroundPatternSvg = (
  svgRoot: SVGSVGElement,
  defs: SVGDefsElement,
  pattern: BackgroundPattern,
  options: {
    width: number;
    height: number;
    offsetX: number;
    offsetY: number;
    isDarkMode: boolean;
  },
) => {
  const { width, height, offsetX, offsetY, isDarkMode } = options;
  const doc = svgRoot.ownerDocument;
  const colors = getPatternColors(pattern);
  const color = (value: string) => applyDarkModeFilter(value, isDarkMode);
  const spacing = pattern.spacing;
  const minorAlpha = colors.minorAlpha * patternLevelAlpha(spacing);

  const el = (name: string, attributes: Record<string, string>) => {
    const node = doc.createElementNS(SVG_NS, name);
    for (const key in attributes) {
      node.setAttribute(key, attributes[key]);
    }
    return node;
  };

  const tile = (x: number, y: number, w: number, h: number) =>
    el("pattern", {
      id: patternId(
        `${backgroundPatternKey(pattern)}:${isDarkMode ? 1 : 0}:${n(
          offsetX,
        )}:${n(offsetY)}`,
      ),
      patternUnits: "userSpaceOnUse",
      x: n(x),
      y: n(y),
      width: n(w),
      height: n(h),
    });

  const finish = (node: SVGElement) => {
    defs.appendChild(node);
    svgRoot.appendChild(
      el("rect", {
        width: n(width),
        height: n(height),
        fill: `url(#${node.getAttribute("id")})`,
      }),
    );
  };

  const line = (path: string, stroke: string, alpha: number) =>
    el("path", {
      d: path,
      fill: "none",
      stroke: color(stroke),
      "stroke-opacity": n(alpha),
    });

  if (pattern.type === "dots" || pattern.type === "isometric") {
    if (minorAlpha <= 0) {
      return;
    }
    const isometric = pattern.type === "isometric";
    const rowHeight = getIsometricRowHeight(spacing);
    const radius = n(getPatternDotRadiusPx(spacing));
    const tileHeight = isometric ? rowHeight * 2 : spacing;
    // tile origin half a cell before scene (0, 0): dots sit inside the tile
    const node = tile(
      mod(offsetX - spacing / 2, spacing),
      mod(offsetY - tileHeight / (isometric ? 4 : 2), tileHeight),
      spacing,
      tileHeight,
    );
    node.setAttribute("fill", color(colors.minor));
    node.setAttribute("fill-opacity", n(minorAlpha));
    const dot = (cx: number, cy: number) =>
      node.appendChild(el("circle", { cx: n(cx), cy: n(cy), r: radius }));
    if (isometric) {
      dot(spacing / 2, rowHeight / 2);
      dot(0, rowHeight * 1.5);
      dot(spacing, rowHeight * 1.5);
    } else {
      dot(spacing / 2, spacing / 2);
    }
    finish(node);
    return;
  }

  if (pattern.type === "lines") {
    if (minorAlpha > 0) {
      const node = tile(0, mod(offsetY, spacing), spacing, spacing);
      node.appendChild(
        line(
          `M0 0H${n(spacing)}M0 ${n(spacing)}H${n(spacing)}`,
          colors.minor,
          minorAlpha,
        ),
      );
      finish(node);
    }
    if (pattern.marginLine) {
      const x = n(PATTERN_MARGIN_X + offsetX);
      const margin = line(
        `M${x} 0V${n(height)}`,
        colors.margin,
        pattern.opacity,
      );
      svgRoot.appendChild(margin);
    }
    return;
  }

  // grid / graph
  const majors = hasMajorLines(pattern);
  const cells = majors ? pattern.majorEvery : 1;
  const majorAlpha = majors
    ? colors.majorAlpha * patternLevelAlpha(spacing * cells)
    : 0;
  const size = spacing * cells;
  const minors: number[] = [];
  for (let i = 1; i < cells; i++) {
    minors.push(i * spacing);
  }
  const edgeAlpha = majors ? majorAlpha : minorAlpha;
  if (edgeAlpha <= 0 && (!minors.length || minorAlpha <= 0)) {
    return;
  }
  const node = tile(mod(offsetX, size), mod(offsetY, size), size, size);
  if (minors.length && minorAlpha > 0) {
    node.appendChild(line(linePath(minors, size), colors.minor, minorAlpha));
  }
  if (edgeAlpha > 0) {
    node.appendChild(
      line(
        linePath([0, size], size),
        majors ? colors.major : colors.minor,
        edgeAlpha,
      ),
    );
  }
  finish(node);
};
