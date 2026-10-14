# Vaultdraw

An offline, local-first vault for [Excalidraw](https://github.com/excalidraw/excalidraw) drawings, a bit like Obsidian but for whiteboards.

You pick a folder on your computer as your vault. Folders are real directories and drawings are ordinary `.excalidraw` files, so you own your data: back it up, sync it or move it however you like. There are no accounts, no cloud and no telemetry.

## Features

- File tree beside the Excalidraw canvas: create, rename, duplicate, move and delete drawings and folders
- Autosave with atomic writes and crash recovery
- Detects changes made outside the app without losing unsaved edits
- Export image dialog (Shift+Cmd+E): PNG or SVG at 1x, 2x or 3x, with or without background, dark mode, embedded scene and selection only. The last-used scale, background and embed setting are remembered. Exports always use the drawing's own colours, even with "Sync canvas with theme" on
- Copy PNG or SVG to the clipboard, from the export dialog or the right-click menu. On macOS the image goes to the native clipboard
- Insert Mermaid diagrams from the main menu or More tools. Conversion runs fully offline, with no AI
- Works fully offline (fonts and assets are bundled)
- Customisable hotkeys (Settings → Hotkeys) and a Cmd/Ctrl+P quick switcher for drawings and commands
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
accent_color = ""            # "#rrggbb" replaces the theme's primary colour; "" = the theme's own

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

[interface]
zoom = 100                   # whole-app zoom, 50 to 200 percent

[navigator]
sort = "name_asc"            # name_asc | name_desc | modified_desc | modified_asc

[files]
confirm_delete = true        # ask before moving to Trash
new_drawing_folder = ""      # relative to the vault root; "" = next to the open drawing
templates_folder = "Templates" # vault folder holding templates, relative to the vault root
```

- **Settings and the file stay in sync.** Changing something in Settings updates `config.toml` and keeps your comments and layout. Editing the file updates the app.
- **Live reload.** Saved changes apply immediately, no restart needed. Delete a line to go back to its default.
- **Typos are safe.** If the file can't be parsed, the app keeps the last good settings and shows a banner such as `config.toml line 7: <error>`. A value of the wrong type falls back to its default and is reported the same way.
- **Settings → Open config folder** opens the folder; **Reload** re-reads it.

`state.json` holds machine state (recent vaults, navigator width, expanded folders, last-used image export options). It is not meant for hand editing.

### Settings reference

Everything here can be changed in **Settings** (Cmd/Ctrl+,) or by editing `config.toml`.

- **Accent colour** (Appearance, `appearance.accent_color`). Replaces the theme's primary colour in both light and dark mode, using a picker or a hex value. If the colour would be hard to read against the theme, it is nudged until it is, and Settings shows "Adjusted for contrast" with the colour actually used. **Reset** (or an empty value) goes back to the theme's own.
- **Interface zoom** (Interface, `interface.zoom`). Scales the whole window from 50 % to 200 %. **Cmd/Ctrl+Shift + `+`**, **`-`** and **`0`** step by 10 and reset to 100 %. Plain **Cmd/Ctrl + `+`**, **`-`** and **`0`** still zoom the canvas, as in Excalidraw.
- **Navigator sort order** (Interface, `navigator.sort`, also the sort button in the navigator toolbar). Four orders: name A to Z, name Z to A, modified new to old, modified old to new. Folders always come first; the order applies within folders and within drawings. Names compare ignoring case and by number, so "Drawing 2" comes before "Drawing 10".
- **Confirm before delete** (Files, `files.confirm_delete`). On by default. Turn it off and "Move to Trash" acts immediately. It only affects moving to Trash, which can be undone from the OS trash.
- **Default folder for new drawings** (Files, `files.new_drawing_folder`). A path relative to the vault root, for example `Sketches/Inbox`. It is created if it doesn't exist. Empty (the default) puts a new drawing next to the open drawing.

#### Per-vault settings

Navigator sort order, the default folder for new drawings and the templates folder can differ per vault. Those rows have a **This vault** switch:

- **On:** the value is saved in `<vault>/.excalidraw-vault/settings.toml`, starting from the value currently in effect. Edits go there.
- **Off:** the key is removed from that file and the global value applies again.

The file lives inside the vault, so it travels with it when you copy, sync or back up the folder. Precedence is per-vault value, then `config.toml`, then the default. Like `config.toml` it is plain TOML, reloads live, keeps your comments, and a bad value is ignored with a notice while the rest still applies.

```toml
# <vault>/.excalidraw-vault/settings.toml
[navigator]
sort = "modified_desc"

[files]
new_drawing_folder = "Sketches/Inbox"
```

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
  "dark": {
    "mSurface": "#1b1d2b",
    "mOnSurface": "#d8dae8",
    "mPrimary": "#82aaff"
  },
  "light": {
    "mSurface": "#f6f6fa",
    "mOnSurface": "#2b2d3a",
    "mPrimary": "#3b6fd8"
  }
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

## Hotkeys

Every Vaultdraw command has a key you can change. Open **Settings → Hotkeys** (Cmd/Ctrl+,).

The page lists all commands with their keys as chips. Type in the filter to narrow by command name or key. The **⌨** button records keys: press a key combination and the list shows every command bound to it. The chips **All**, **Assigned**, **Customised**, **Unassigned** and **Conflicts** filter the list (Conflicts appears only when there is one).

- **+** records a new key for a command. A command can have several.
- **×** on a key removes it. **↺** resets the command to its defaults.
- While recording, **Backspace** clears the key and **Esc** cancels.
- Keys the system or the app menu owns (Cmd+Q, Cmd+W, Cmd+Tab, Cmd+C/X/V/Z/A and similar) are refused, with the reason shown.
- A key used by two commands, or by one of Excalidraw's own shortcuts, is shown in red with what it clashes with. It is allowed, and Vaultdraw's binding wins.

### Defaults

`Mod` is Cmd on macOS and Ctrl on Windows and Linux. A dash means no key by default.

| Command id | What it does | macOS | Windows / Linux |
| --- | --- | --- | --- |
| `file.save` | Save drawing | ⌘S, ⇧⌘S, ⌃S | Ctrl+S, Ctrl+Shift+S |
| `settings.open` | Open settings | ⌘,, ⌃, | Ctrl+, |
| `navigator.focusSearch` | Search drawings | ⇧⌘F, ⌃⇧F | Ctrl+Shift+F |
| `view.zoomIn` | Zoom in (interface) | ⇧⌘=, ⇧⌘Num + | Ctrl+Shift+=, Ctrl+Shift+Num + |
| `view.zoomOut` | Zoom out (interface) | ⇧⌘-, ⇧⌘Num - | Ctrl+Shift+-, Ctrl+Shift+Num - |
| `view.zoomReset` | Reset interface zoom | ⇧⌘0, ⇧⌘Num 0 | Ctrl+Shift+0, Ctrl+Shift+Num 0 |
| `palette.quickSwitcher` | Quick switcher | ⌘P | Ctrl+P |
| `vault.newDrawing` | New drawing | ⌘N | Ctrl+N |
| `vault.newFromTemplate` | New drawing from template | ⌥⌘N, ⌃⌥N | Ctrl+Alt+N |
| `view.toggleNavigator` | Toggle navigator | ⌘\  | Ctrl+\  |
| `vault.switch` | Open another vault | — | — |
| `file.revealInFinder` | Reveal drawing in Finder | — | — |
| `file.duplicate` | Duplicate drawing | — | — |
| `appearance.toggleMode` | Toggle light/dark mode | — | — |
| `settings.openHotkeys` | Open hotkey settings | — | — |

Canvas zoom is Excalidraw's own: **Cmd/Ctrl + `+`**, **`-`** and **`0`**. Interface zoom adds Shift.

### The `[hotkeys]` table

Settings writes to `config.toml`, and you can edit it by hand. Only your changes are stored, as a list of keys per command id:

```toml
[hotkeys]
# add a second key (list the default too, or it is replaced)
"file.save" = ["Mod+S", "Alt+S"]

# unassign: an empty list
"vault.newDrawing" = []

# change a key
"view.toggleNavigator" = ["Mod+B"]
```

Ids contain dots, so quote them. Delete a line to go back to the default. Edits apply as soon as the file is saved, with no restart.

Keys are modifiers plus one key, joined with `+`: `Mod`, `Ctrl`, `Alt`, `Shift`, `Meta`. `Mod` means Cmd on macOS and Ctrl elsewhere, so one file works on both. The key is the physical key (`KeyboardEvent.code`) without the `Key` or `Digit` prefix: `N`, `0`, `Comma`, `Equal`, `Backslash`, `F2`, `ArrowUp`, `Numpad0`. These aliases are accepted too: `Cmd`, `CmdOrCtrl`, `Option`, `Esc`, `Plus`, `=`, `,`, `Digit0`, `KeyN`.

Mistakes never break the app. They show as a warning banner in Settings and the rest of the file still applies:

- An unknown command id is kept in the file and reported (it may belong to a newer version).
- A key that can't be parsed is ignored.
- A value that isn't a list keeps the command's defaults.

### Quick switcher

**Cmd/Ctrl+P** opens a list of drawings and commands. Type a few letters of a drawing name, in order and not necessarily next to each other (`vdg` finds `vault-design`), or of a command. Start with `>` to see commands only. Use Up and Down to move, Enter to open or run, and Esc to close.

Excalidraw's own command palette is still on Cmd/Ctrl+/ and Cmd/Ctrl+Shift+P.

## Search

Search finds text inside every drawing in the vault. Type in the search box at the top of the navigator, or press Cmd+Shift+F (Ctrl+Shift+F on Windows and Linux) to move there.

It searches drawing names and folder paths, text elements, labels inside shapes and arrows, and frame names. Text inside library items is not searched.

Results are grouped by drawing, with up to five highlighted snippets under each one. Use Up and Down to move, Enter to open the selected row, and Escape to clear the search. Clicking a snippet opens the drawing, zooms to that element and selects it. For a label, the shape or arrow it belongs to is selected.

Matching rules:

- Case, accents and character width are ignored: `cafe` finds `Café`, and full-width letters find ASCII.
- A term can match inside a word, so `graph` finds `Dijkstra graphs`.
- Every word you type must appear in the drawing, but the words can be in different elements.
- Chinese, Japanese and Korean text is searched as written, without spaces between words.

The index is stored outside the vault, in the state folder (`~/.local/state/vaultdraw/index/` by default; `VAULTDRAW_STATE_DIR` changes the folder). Nothing is written into your vault. The index is rebuilt automatically when it is missing or damaged, and it is safe to delete. When a large vault is indexed for the first time, the status line shows progress, such as "Indexing 1,234 of 5,000 drawings…", and results cover only the drawings indexed so far.

## Templates

A template is an ordinary `.excalidraw` file, so any drawing can become one, and a template can be opened and edited like any other drawing.

- **Vault templates** live in `Templates/` at the vault root. Change the folder in **Settings → Files → Templates Folder** (`files.templates_folder`). Like the other per-vault settings, it is stored in `<vault>/.excalidraw-vault/settings.toml` when set for that vault.
- **Global templates** live in `templates/` inside the config folder (`~/.config/vaultdraw/templates/` on macOS and Linux). All vaults share them.

To start a drawing from a template, use **New from template…** in the header, the button in an empty vault, or Cmd+Option+N (Ctrl+Alt+N on Windows and Linux). The picker has a search box with thumbnails for each template. Use the arrow keys to move and Enter to create the drawing. A new drawing gets fresh element ids, so it never shares ids with its template, and it keeps the template's canvas background.

To make a template, choose **Save as template…** in a drawing's ⋯ menu, then pick **This vault** or **All vaults**.

Templates are left out of the Recent list. They still appear in the navigator, where you can open and edit them.

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
