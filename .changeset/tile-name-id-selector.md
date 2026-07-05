---
"@kumikijs/compiler": minor
"@kumikijs/runtime": minor
---

feat(compiler,runtime): wire static `TileName#id` selector end-to-end (#131).

The `TileName#id` selector in `reducer r on=ui.click(NewBtn#save)` is now honoured all the way from parse to dispatch. The compiler emits the id filter into the generated handler, and the runtime `_dispatch` skips reducers whose `selector.id` does not match the dispatched element's `el.id` — a defence-in-depth layer that keeps working even when the tile's `{id}` is computed at runtime.

- compiler: `packages/compiler/src/codegen.ts` threads `selector.id` through the tile dispatcher.
- runtime: `_dispatch` (`packages/runtime/src/core.ts`) filters by `el.id` before invoking the reducer.
- spec: `docs/spec/language.md` §1.6.2 formalises the selector shape; `docs/spec/errors.md` adds `E0211 undef-tile-in-selector`.
