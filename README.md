# Vaultdraw

An offline, local-first vault for [Excalidraw](https://github.com/excalidraw/excalidraw) drawings, a bit like Obsidian but for whiteboards.

You pick a folder on your computer as your vault. Folders are real directories and drawings are ordinary `.excalidraw` files, so you own your data: back it up, sync it or move it however you like. There are no accounts, no cloud and no telemetry.

## Features

- File tree beside the Excalidraw canvas: create, rename, duplicate, move and delete drawings and folders
- Autosave with atomic writes and crash recovery
- Detects changes made outside the app without losing unsaved edits
- Export to PNG and SVG
- Works fully offline (fonts and assets are bundled)

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
