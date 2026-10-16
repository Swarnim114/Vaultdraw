import { appearanceControls } from "./Appearance";
import { drawingControls } from "./Drawing";
import { filesControls } from "./Files";
import { generalControls } from "./General";
import { hotkeysControls } from "./Hotkeys";
import { interfaceControls } from "./Interface";
import { linksControls } from "./Links";
import { tagsControls } from "./TagsSettings";
import { pageControls } from "./Page";
import { pensControls } from "./Pens";
import { toolDefaultsControls } from "./ToolDefaults";

import type { SettingControls } from "../SettingsContext";

/** Every setting's control, keyed by schema id. */
export const SETTING_CONTROLS: SettingControls = {
  ...generalControls,
  ...appearanceControls,
  ...pageControls,
  ...interfaceControls,
  ...drawingControls,
  ...pensControls,
  ...toolDefaultsControls,
  ...filesControls,
  ...linksControls,
  ...tagsControls,
  ...hotkeysControls,
};
