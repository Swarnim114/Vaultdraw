# Vaultdraw

An offline, local-first vault for [Excalidraw](https://github.com/excalidraw/excalidraw) drawings, a bit like Obsidian but for whiteboards.

You pick a folder on your computer as your vault. Folders are real directories and drawings are ordinary `.excalidraw` files, so you own your data: back it up, sync it or move it however you like. There are no accounts, no cloud and no telemetry.

## Features

- File tree beside the Excalidraw canvas: create, rename, duplicate, move and delete drawings and folders
- Autosave with atomic writes and crash recovery
- Detects changes made outside the app without losing unsaved edits
- Export to PNG and SVG
- Works fully offline (fonts and assets are bundled)
- Plain-text config folder, editable by hand or in Settings, reloaded live
- Colour themes in Noctalia format, nine built in, light and dark (in progress)

## Configuration

All settings live in one folder, like kitty, Ghostty or Zed:

| OS | Config folder | Machine state |
| --- | --- | --- |
| macOS, Linux | `$XDG_CONFIG_HOME/vaultdraw`, else `~/.config/vaultdraw` | `$XDG_STATE_HOME/vaultdraw/state.json`, else `~/.local/state/vaultdraw/state.json` |
| Windows | `%APPDATA%\Vaultdraw` | `%LOCALAPPDATA%\Vaultdraw\state.json` |

```
vaultdraw/
├── config.toml   your settings
└── themes/       colour themes
```

`config.toml` is created on first launch (with comments explaining each key). The keys and their defaults:

```toml
[appearance]
theme = "Default"            # a built-in theme or one in themes/
mode = "system"              # light | dark | system
sync_canvas = false          # canvas follows the theme's colours
canvas_background = "#ffffff" # for new drawings when sync_canvas is off

[editor]                     # defaults for new elements
font_family = 5              # 5 Excalifont, 6 Nunito, 8 Comic Shanns, 1 Virgil, 2 Helvetica, 3 Cascadia
font_size = 20
stroke_color = "#1e1e1e"
background_color = "transparent"
fill_style = "solid"         # solid | hachure | cross-hatch
stroke_width = 2
roughness = 1                # 0 architect, 1 artist, 2 cartoonist

[saving]
autosave_delay_ms = 500      # idle time before an edit is written to disk
```

- **Settings and the file stay in sync.** Changing something in Settings updates `config.toml` and keeps your comments and layout. Editing the file updates the app.
- **Live reload.** Saved changes apply immediately, no restart needed. Delete a line to go back to its default.
- **Typos are safe.** If the file can't be parsed, the app keeps the last good settings and shows a banner such as `config.toml line 7: <error>`. A value of the wrong type falls back to its default and is reported the same way.
- **Settings → Open config folder** opens the folder; **Reload** re-reads it.

`state.json` holds machine state (recent vaults, navigator width, expanded folders). It is not meant for hand editing.

### Themes

A theme sets the colours of the whole app: the file tree, header, Settings and Excalidraw's toolbars, menus and dialogs. Every theme has a dark and a light variant, so theme and mode are chosen separately, in **Settings → Appearance** or in `config.toml`:

```toml
[appearance]
theme = "Tokyo Night"   # theme name, case-insensitive
mode = "system"         # light | dark | system (follows the OS)
sync_canvas = true      # canvas follows the theme too
```

**Built-in themes:** Default, Dracula, Tokyo Night, Catppuccin, Everforest, Gruvbox, Nord, Rosé Pine, Solarized. If `theme` names a theme that doesn't exist, Vaultdraw uses Default and shows a warning.

#### Adding a theme

Themes use the [Noctalia](https://github.com/noctalia-dev/noctalia-colorschemes) palette format, so existing Noctalia palettes work unchanged. Put the `.json` file in `themes/` inside the config folder (`~/.config/vaultdraw/themes/` on macOS and Linux), in either layout:

```
themes/
├── Midnight.json          a single file
└── Paper/
    └── Paper.json         a folder, as Noctalia ships them
```

The file or folder name is the theme's name: `theme = "Midnight"` selects `Midnight.json`. A theme in `themes/` with the same name as a built-in one replaces it.

A theme needs only three colours per variant (background, text, accent); everything else is derived:

```json
{
  "dark":  { "mSurface": "#1b1d2b", "mOnSurface": "#d8dae8", "mPrimary": "#82aaff" },
  "light": { "mSurface": "#f6f6fa", "mOnSurface": "#2b2d3a", "mPrimary": "#3b6fd8" }
}
```

You can also leave out `light` or `dark` entirely; the missing variant is generated from the other one. Whatever colours a theme uses, Vaultdraw adjusts them where needed so text stays readable.

The full set of roles, all optional except the first three:

| Role | Colours in Vaultdraw |
| --- | --- |
| `mSurface` | Canvas and app background; base of the sidebar, header and menus |
| `mOnSurface` | Text and icons; black and grey strokes on a synced canvas |
| `mPrimary` | Accent: selected items and tools, buttons, links, focus rings, selection outline |
| `mOnPrimary` | Text and icons on accent-coloured buttons |
| `mSurfaceVariant` | Tint of the sidebar and header |
| `mOnSurfaceVariant` | Secondary (muted) text |
| `mError` | Errors and delete actions; red on a synced canvas |
| `mSecondary`, `mTertiary` | Extra accents, used for palette colours on a synced canvas |
| `mShadow` | Shadows under menus and dialogs |
| `mOnSecondary`, `mOnTertiary`, `mOnError`, `mOutline`, `mHover`, `mOnHover` | Accepted for Noctalia compatibility; derived if missing |
| `terminal` | Optional ANSI colours: green and yellow set success and warning; all of them feed the canvas palette when synced |

Optional top-level `name` and `author` fields are for display only.

#### Sync canvas with theme

With `sync_canvas = true` (**Sync canvas with theme** in Settings), the canvas is recoloured on screen: its background becomes the theme's background, and the pencil, stroke and fill colours from Excalidraw's palette become matching theme colours. This only changes what you see. Saved drawings and PNG/SVG exports keep Excalidraw's standard colours, so they look the same for anyone who opens them. With it off, the canvas renders as in regular Excalidraw.

Themes are data only: colour values, no code.

## Repository layout

| Path | What it is |
| --- | --- |
| `excalidraw-desktop/` | The Vaultdraw desktop app (Tauri 2 + React) |
| `excalidraw-desktop/src-tauri/` | Rust backend: filesystem access, file watcher, recovery |
| `packages/excalidraw/` | The Excalidraw editor |
| `packages/{common,element,math,utils,fractional-indexing,laser-pointer}` | Editor building blocks |

## Development

Requires Node 18+, Yarn 1 and the [Rust/Tauri prerequisites](https://tauri.app/start/prerequisites/).

```bash
yarn install
yarn start               # run the desktop app in dev mode
yarn desktop:build       # build the packaged app
yarn desktop:test        # desktop unit tests
yarn test:typecheck      # TypeScript
yarn test:app            # all unit tests (editor + desktop)
yarn --cwd excalidraw-desktop test:e2e   # Playwright browser tests
```

## License and credits

Vaultdraw is a fork of [Excalidraw](https://github.com/excalidraw/excalidraw) and is released under the MIT License. See [LICENSE](LICENSE). Vaultdraw is not affiliated with or endorsed by Excalidraw.
