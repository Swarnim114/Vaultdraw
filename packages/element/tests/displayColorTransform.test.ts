import {
  applyDarkModeFilter,
  COLOR_PALETTE,
  getDisplayColorTransformVersion,
  invertColorForDarkMode,
  setDisplayColorTransform,
  THEME,
} from "@excalidraw/common";
import { API } from "@excalidraw/excalidraw/tests/helpers/api";

import { ShapeCache } from "../src/shape";

import type { ExcalidrawRectangleElement } from "../src/types";

const renderConfig = {
  isExporting: false,
  canvasBackgroundColor: COLOR_PALETTE.white,
  embedsValidationStatus: new Map(),
  theme: THEME.LIGHT,
};

describe("display color transform", () => {
  afterEach(() => {
    setDisplayColorTransform(null);
  });

  it("keeps default behavior when no transform is set", () => {
    expect(applyDarkModeFilter("#1e1e1e", false)).toBe("#1e1e1e");
    expect(applyDarkModeFilter("#1e1e1e", true)).toBe(
      invertColorForDarkMode("#1e1e1e"),
    );
    expect(applyDarkModeFilter("#1e1e1e")).not.toBe("#1e1e1e");
  });

  it("applies the transform in both light and dark mode", () => {
    const transform = vi.fn(
      (color: string, isDarkMode: boolean) =>
        `${isDarkMode ? "dark" : "light"}:${color}`,
    );
    setDisplayColorTransform(transform);

    expect(applyDarkModeFilter("#1e1e1e", false)).toBe("light:#1e1e1e");
    expect(applyDarkModeFilter("#1e1e1e", true)).toBe("dark:#1e1e1e");
    expect(transform).toHaveBeenCalledTimes(2);
  });

  it("increments the version on every set", () => {
    const version = getDisplayColorTransformVersion();
    setDisplayColorTransform((color) => color);
    expect(getDisplayColorTransformVersion()).toBe(version + 1);
    setDisplayColorTransform(null);
    expect(getDisplayColorTransformVersion()).toBe(version + 2);
  });

  it("invalidates cached shapes when the version changes", () => {
    const element = API.createElement({
      type: "rectangle",
    }) as ExcalidrawRectangleElement;

    ShapeCache.generateElementShape(element, renderConfig);
    expect(ShapeCache.get(element, THEME.LIGHT)).toBeDefined();

    setDisplayColorTransform((color) => color);
    expect(ShapeCache.get(element, THEME.LIGHT)).toBeUndefined();
    expect(ShapeCache.get(element, null)).toBeUndefined();

    ShapeCache.generateElementShape(element, renderConfig);
    expect(ShapeCache.get(element, THEME.LIGHT)).toBeDefined();
  });
});
