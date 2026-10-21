/** Laser swatches show the real colour: the canvas never filters the laser. */
import { act, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { SettingsModal } from "../components/settings/SettingsModal";
import { setSettingsScope } from "../components/settings/settingsScope";
import { updatePreferences } from "../vault/preferences";
import { disposeSettings } from "../vault/settingsSync";
import {
  attachVaultSettings,
  detachVaultSettings,
} from "../vault/vaultSettings";

const vault = { handle: "v", name: "V", path: "/v", readOnly: false };

beforeEach(() => {
  window.localStorage.clear();
  setSettingsScope("global");
});
afterEach(() => {
  detachVaultSettings();
  disposeSettings();
  window.localStorage.clear();
});

const swatchColour = (el: HTMLElement) =>
  el.style.getPropertyValue("--vault-swatch").toLowerCase();

describe("laser swatches in dark mode", () => {
  it.each(["light", "dark"] as const)(
    "%s: raw colours, no dark filter",
    async (mode) => {
      await attachVaultSettings(window, "v", { tauri: false });
      act(() => {
        updatePreferences({ theme: mode, laserColor: "#1971c2" }, window);
      });
      render(
        <SettingsModal
          vault={vault}
          onClose={() => {}}
          ownerDocument={document}
          initialPage={"tools:laser" as never}
        />,
      );
      const panel = screen.getByTestId("tools-laser");
      expect(
        within(panel).queryByText(/shown as on the dark canvas/),
      ).toBeNull();
      const blue = within(panel).getByRole("radio", {
        name: /Laser colour #1971c2/,
      });
      expect(blue).toHaveAttribute("aria-checked", "true");
      expect(swatchColour(blue)).toBe("#1971c2");
      expect(blue.getAttribute("title")).toBe("#1971c2");
      expect(
        swatchColour(
          within(panel).getByRole("radio", { name: /Laser colour red/ }),
        ),
      ).toBe("red");
    },
  );
});
