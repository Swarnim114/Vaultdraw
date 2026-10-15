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

## Cendre (cendre.json, cendre-medium.json, cendre-soft.json)

Not from Noctalia. Mapped by hand from the Ghostty files in
https://github.com/Aejkatappaja/cendre (`extras/ghostty/`, commit
`5c9d924a4c75c130a1c812ee3e240d78a92d2c3a`), one file per depth (hard, medium,
soft): background → mSurface, foreground → mOnSurface, cursor (ember) →
mPrimary, palette 0 → mSurfaceVariant, 7 → mOnSurfaceVariant, 8 → mOutline,
3 → mSecondary, 2 → mTertiary, 1 → mError, the 16 ANSI colours → terminal.
Cendre is dark only; Vaultdraw generates the light variant. Licence:

> MIT License
>
> Copyright (c) 2026 aejkatappaja
>
> Permission is hereby granted, free of charge, to any person obtaining a copy
> of this software and associated documentation files (the "Software"), to deal
> in the Software without restriction, including without limitation the rights
> to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
> copies of the Software, and to permit persons to whom the Software is
> furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in all
> copies or substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
> IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
> FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
> AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
> LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
> OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
> SOFTWARE.
