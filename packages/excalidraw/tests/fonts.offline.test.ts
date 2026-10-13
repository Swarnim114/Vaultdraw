import { afterEach, describe, expect, it, vi } from "vitest";

import { ExcalidrawFontFace } from "../fonts/ExcalidrawFontFace";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("offline desktop font policy", () => {
  it("keeps bundled assets without adding a remote fallback", () => {
    vi.stubEnv("VITE_APP_OFFLINE", "true");
    const face = new ExcalidrawFontFace("Test", "fonts/test.woff2");
    expect(face.urls.length).toBeGreaterThan(0);
    expect(face.urls.map(String).some((url) => /^https?:/.test(url))).toBe(
      false,
    );
  });

  it("does not load remote custom fonts in offline builds", () => {
    vi.stubEnv("VITE_APP_OFFLINE", "true");
    const face = new ExcalidrawFontFace(
      "Test",
      "https://example.com/private-font.woff2",
    );
    expect(face.urls).toEqual([]);
  });

  it("continues supporting embedded fonts without network access", () => {
    vi.stubEnv("VITE_APP_OFFLINE", "true");
    const uri = "data:font/woff2;base64,AA==";
    expect(new ExcalidrawFontFace("Test", uri).urls).toEqual([uri]);
  });

  it("preserves CDN fallback for existing web consumers", () => {
    vi.stubEnv("VITE_APP_OFFLINE", "false");
    const urls = new ExcalidrawFontFace("Test", "fonts/test.woff2").urls;
    expect(
      urls.map(String).some((url) => url.startsWith("https://esm.sh/")),
    ).toBe(true);
  });
});
