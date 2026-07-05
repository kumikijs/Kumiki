---
"@kumikijs/compiler": minor
"@kumikijs/cli": minor
"@kumikijs/vite": minor
---

feat(compiler,cli,vite): `--strict-selector-id` to flag `TileName#id` typos at check time (#149).

`E0212 selector-id-mismatch` is now emitted (opt-in via `strictSelectorId`) when a reducer subscribes to `Tile#id` but every declaration of `Tile` has a **literal** `{id: "..."}` that does not match the selector's id — the reducer would otherwise silently never fire at runtime. Tiles whose `{id}` is computed are deliberately exempt so the runtime filter remains the authority for dynamic ids.

- compiler: `check()` gains `strictSelectorId`; `E0212` mirrors the existing `strictIcons` / `strictA11y` gate pattern.
- cli: `kumiki check --strict-selector-id` and `kumiki build --strict-selector-id`.
- vite: `strictSelectorId: true` plugin option.
- spec: `docs/spec/errors.md` documents `E0212` alongside the runtime-filter fallback for dynamic ids.
