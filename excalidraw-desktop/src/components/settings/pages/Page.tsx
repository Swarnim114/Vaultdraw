import { useSyncExternalStore } from "react";

import { updatePageSetup } from "@excalidraw/excalidraw/data/pageSetup";

import type { PageSetup } from "@excalidraw/excalidraw/data/pageSetup";

import {
  getDefaultPageSetup,
  setDefaultPageSetup,
} from "../../../vault/pageDefaults";
import {
  getPreferences,
  subscribePreferences,
} from "../../../vault/preferences";
import {
  LAYOUT_OPTIONS,
  ORIENTATION_OPTIONS,
  PAPER_THEME_OPTIONS,
  orientationChanges,
} from "../../page/pageOptions";
import { PageSizeControl } from "../../page/PageSizeControl";
import { SettingRow } from "../SettingRow";
import { useSettings, type SettingControls } from "../SettingsContext";

import { Segmented } from "./controls";

const MODE_OPTIONS = [
  { label: "Normal canvas", val: "normal" },
  { label: "Pages", val: "page" },
] as const;

/** The app's default page setup; re-renders when any preference changes. */
const useDefaultPageSetup = () => {
  const { win } = useSettings();
  useSyncExternalStore(subscribePreferences, () =>
    JSON.stringify(getPreferences(win)),
  );
  const setup = getDefaultPageSetup(win);
  const change = (changes: Partial<PageSetup>) =>
    setDefaultPageSetup(updatePageSetup(setup, changes), win);
  return { setup, change };
};

const ModeSetting = () => {
  const { setup, change } = useDefaultPageSetup();
  return (
    <SettingRow id="page-mode">
      <Segmented
        options={MODE_OPTIONS}
        value={setup.enabled ? "page" : "normal"}
        onChange={(mode) => change({ enabled: mode === "page" })}
      />
    </SettingRow>
  );
};

const LayoutSetting = () => {
  const { setup, change } = useDefaultPageSetup();
  return (
    <SettingRow id="page-layout">
      <Segmented
        options={LAYOUT_OPTIONS}
        value={setup.layout}
        onChange={(layout) => change({ layout })}
      />
    </SettingRow>
  );
};

const SizeSetting = () => {
  const { setup, change } = useDefaultPageSetup();
  return (
    <SettingRow id="page-size">
      <PageSizeControl
        size={setup.size}
        width={setup.width}
        height={setup.height}
        onChange={change}
      />
    </SettingRow>
  );
};

const OrientationSetting = () => {
  const { setup, change } = useDefaultPageSetup();
  return (
    <SettingRow id="page-orientation">
      <Segmented
        options={ORIENTATION_OPTIONS}
        value={setup.orientation}
        onChange={(o) => change(orientationChanges(setup, o))}
      />
    </SettingRow>
  );
};

const PaperThemeSetting = () => {
  const { setup, change } = useDefaultPageSetup();
  return (
    <SettingRow id="page-paper-theme">
      <Segmented
        options={PAPER_THEME_OPTIONS}
        value={setup.paperTheme}
        onChange={(paperTheme) => change({ paperTheme })}
      />
    </SettingRow>
  );
};

export const pageControls: SettingControls = {
  "page-mode": { Component: ModeSetting },
  "page-layout": { Component: LayoutSetting },
  "page-size": { Component: SizeSetting },
  "page-orientation": { Component: OrientationSetting },
  "page-paper-theme": { Component: PaperThemeSetting },
};
