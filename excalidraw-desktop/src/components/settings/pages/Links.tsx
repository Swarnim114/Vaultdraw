import { useState } from "react";

import { SettingRow } from "../SettingRow";
import { useSettings, type SettingControls } from "../SettingsContext";

import { isHintChars } from "../../../vault/preferences";

import { Switch } from "./controls";

import type {
  NewLinkFormat,
  OpenModifier,
  ShapeLinkFormat,
  UpdateOnRename,
} from "../../../links/types";

const NEW_LINK_FORMATS: readonly { val: NewLinkFormat; label: string }[] = [
  { val: "shortest", label: "Shortest path when possible" },
  { val: "relative", label: "Relative path from this drawing" },
  { val: "absolute", label: "Absolute path in the vault" },
];

const SHAPE_LINK_FORMATS: readonly { val: ShapeLinkFormat; label: string }[] = [
  { val: "wikilink", label: "[[Name]]" },
  { val: "vaultdraw-url", label: "vaultdraw:// URL" },
];

const OPEN_MODIFIERS: readonly { val: OpenModifier; label: string }[] = [
  { val: "mod", label: "Cmd / Ctrl" },
  { val: "alt", label: "Alt / Option" },
  { val: "ctrl", label: "Ctrl" },
  { val: "shift", label: "Shift" },
];

const UPDATE_OPTIONS: readonly { val: string; label: string }[] = [
  { val: "true", label: "Always" },
  { val: "ask", label: "Ask each time" },
  { val: "false", label: "Never" },
];

const parseUpdate = (text: string): UpdateOnRename =>
  text === "ask" ? "ask" : text === "true";

const NewLinkFormatSetting = () => {
  const { links, setLinks } = useSettings();
  return (
    <SettingRow id="link-format" htmlFor="vault-link-format">
      <select
        id="vault-link-format"
        className="vault-input"
        value={links.newLinkFormat}
        onChange={(e) =>
          setLinks({ newLinkFormat: e.target.value as NewLinkFormat })
        }
      >
        {NEW_LINK_FORMATS.map((o) => (
          <option key={o.val} value={o.val}>
            {o.label}
          </option>
        ))}
      </select>
    </SettingRow>
  );
};

const ShapeLinkFormatSetting = () => {
  const { links, setLinks } = useSettings();
  return (
    <SettingRow id="link-shape-format" htmlFor="vault-link-shape-format">
      <select
        id="vault-link-shape-format"
        className="vault-input"
        value={links.shapeLinkFormat}
        onChange={(e) =>
          setLinks({ shapeLinkFormat: e.target.value as ShapeLinkFormat })
        }
      >
        {SHAPE_LINK_FORMATS.map((o) => (
          <option key={o.val} value={o.val}>
            {o.label}
          </option>
        ))}
      </select>
    </SettingRow>
  );
};

const OpenModifierSetting = () => {
  const { links, setLinks } = useSettings();
  return (
    <SettingRow id="link-open-modifier" htmlFor="vault-link-open-modifier">
      <select
        id="vault-link-open-modifier"
        className="vault-input"
        value={links.openModifier}
        onChange={(e) =>
          setLinks({ openModifier: e.target.value as OpenModifier })
        }
      >
        {OPEN_MODIFIERS.map((o) => (
          <option key={o.val} value={o.val}>
            {o.label}
          </option>
        ))}
      </select>
    </SettingRow>
  );
};

const UpdateOnRenameSetting = () => {
  const { links, setLinks } = useSettings();
  return (
    <SettingRow id="link-update-on-rename" htmlFor="vault-link-update">
      <select
        id="vault-link-update"
        className="vault-input"
        value={String(links.updateOnRename)}
        onChange={(e) =>
          setLinks({ updateOnRename: parseUpdate(e.target.value) })
        }
      >
        {UPDATE_OPTIONS.map((o) => (
          <option key={o.val} value={o.val}>
            {o.label}
          </option>
        ))}
      </select>
    </SettingRow>
  );
};

const AutocompleteSetting = () => {
  const { links, setLinks } = useSettings();
  return (
    <SettingRow id="link-autocomplete" htmlFor="vault-link-autocomplete">
      <Switch
        id="vault-link-autocomplete"
        checked={links.autocomplete}
        onChange={(autocomplete) => setLinks({ autocomplete })}
      />
    </SettingRow>
  );
};

const HintCharsSetting = () => {
  const { links, setLinks } = useSettings();
  const [draft, setDraft] = useState<string | null>(null);
  const invalid = draft !== null && !isHintChars(draft);
  const commit = () => {
    if (draft !== null && isHintChars(draft)) {
      if (draft !== links.hintChars) {
        setLinks({ hintChars: draft });
      }
      setDraft(null);
    }
  };
  return (
    <SettingRow
      id="link-hint-chars"
      htmlFor="vault-link-hint-chars"
      details={
        invalid ? (
          <span role="alert">
            Use at least 2 different lowercase characters, with no spaces.
          </span>
        ) : undefined
      }
    >
      <input
        id="vault-link-hint-chars"
        type="text"
        className="vault-input"
        spellCheck={false}
        autoComplete="off"
        aria-invalid={invalid}
        value={draft ?? links.hintChars}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            commit();
          } else if (e.key === "Escape" && draft !== null) {
            e.stopPropagation();
            setDraft(null);
          }
        }}
      />
    </SettingRow>
  );
};

export const linksControls: SettingControls = {
  "link-format": { Component: NewLinkFormatSetting },
  "link-shape-format": { Component: ShapeLinkFormatSetting },
  "link-open-modifier": { Component: OpenModifierSetting },
  "link-update-on-rename": { Component: UpdateOnRenameSetting },
  "link-autocomplete": { Component: AutocompleteSetting },
  "link-hint-chars": { Component: HintCharsSetting },
};
