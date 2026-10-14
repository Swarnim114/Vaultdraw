import { appearanceControls } from "./Appearance";
import { drawingControls } from "./Drawing";
import { filesControls } from "./Files";
import { generalControls } from "./General";
import { hotkeysControls } from "./Hotkeys";
import { interfaceControls } from "./Interface";

import type { SettingControls } from "../SettingsContext";

/** Every setting's control, keyed by schema id. */
export const SETTING_CONTROLS: SettingControls = {
  ...generalControls,
  ...appearanceControls,
  ...interfaceControls,
  ...drawingControls,
  ...filesControls,
  ...hotkeysControls,
};
