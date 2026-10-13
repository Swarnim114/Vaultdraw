# Community palettes: source

The `*.json` files in this folder were imported from Noctalia's community
palette repository:

- Repository: https://github.com/noctalia-dev/community-palettes
  (formerly `noctalia-colorschemes`)
- Commit: `a88b6364057c042ff81c49f085d7957c2575dd0f` (branch `main`,
  committed 2026-10-10)
- Downloaded: 2026-10-13

Each palette was imported from `<Name>/<Name>.json` with
`scripts/import-noctalia-palettes.mjs --from-dir <checkout> --out src/theme/builtin/community --author "Noctalia community palettes"`.
The folder name became `"name"`, colours were lower-cased, and keys the
theme engine does not use (`mSurfaceDim`, `mOnSurfaceDim`, `mOutlineVariant`,
`mPanel`, `mOnPanel`, a misplaced `terminal.white`) were dropped. No colour
values were edited by hand.

## Licence

The source repository has **no licence file** (checked at the commit above).
The palettes are the work of their community contributors; see the
repository's commit history for individual authorship. They are attributed
here as "Noctalia community palettes".
