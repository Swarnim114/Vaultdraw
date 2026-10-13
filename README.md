# Vaultdraw

An offline, local-first vault for [Excalidraw](https://github.com/excalidraw/excalidraw) drawings, a bit like Obsidian but for whiteboards.

You pick a folder on your computer as your vault. Folders are real directories and drawings are ordinary `.excalidraw` files, so you own your data: back it up, sync it or move it however you like. There are no accounts, no cloud and no telemetry.

## Features

- File tree beside the Excalidraw canvas: create, rename, duplicate, move and delete drawings and folders
- Autosave with atomic writes and crash recovery
- Detects changes made outside the app without losing unsaved edits
- Export to PNG and SVG
- Works fully offline (fonts and assets are bundled)
- Plain-text config folder, editable by hand or in Settings, reloaded live (in progress)

## Configuration

> In progress: this describes how configuration works once the current work lands.

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

### Themes (coming soon)

Every theme has a dark and a light variant; `mode` picks which one you see. To add a theme, drop a palette in [Noctalia](https://github.com/noctalia-dev/noctalia-colorschemes) format into `themes/` and choose it in Settings or set `theme` to its name. Existing Noctalia palettes work unchanged. A minimal theme needs only a background, text and accent colour per mode; the rest is derived:

```json
{
  "dark":  { "mSurface": "#282a36", "mOnSurface": "#f8f8f2", "mPrimary": "#bd93f9" },
  "light": { "mSurface": "#f8f8f2", "mOnSurface": "#282a36", "mPrimary": "#7c3aed" }
}
```

A theme colours both the vault UI and the Excalidraw toolbars and menus. With `sync_canvas = true` the canvas background, strokes and colour palette follow the theme on screen only; saved drawings and exports keep their own colours.

Themes are data only: CSS colour values, no code.

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
