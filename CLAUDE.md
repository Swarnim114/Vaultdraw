# CLAUDE.md

## Project Structure

Vaultdraw is an offline desktop vault built on a fork of the Excalidraw editor:

- **`excalidraw-desktop/`** - The Vaultdraw desktop app (Tauri 2 + React); Rust backend in `src-tauri/`
- **`packages/excalidraw/`** - The Excalidraw editor React component (kept close to upstream so it can be synced)
- **`packages/`** - Core packages: `@excalidraw/common`, `@excalidraw/element`, `@excalidraw/math`, `@excalidraw/utils`

## Development Workflow

1. **Package Development**: Work in `packages/*` for editor features
2. **App Development**: Work in `excalidraw-desktop/` for vault and desktop features
3. **Testing**: Always run `yarn test:update` before committing
4. **Type Safety**: Use `yarn test:typecheck` to verify TypeScript

## Development Commands

```bash
yarn test:typecheck  # TypeScript type checking
yarn test:update     # Run all tests (with snapshot updates)
yarn fix             # Auto-fix formatting and linting issues
```

## Architecture Notes

### Package System

- Uses Yarn workspaces for monorepo management
- Internal packages use path aliases (see `vitest.config.mts`)
- Build system uses Vite for the desktop app
- TypeScript throughout with strict configuration
