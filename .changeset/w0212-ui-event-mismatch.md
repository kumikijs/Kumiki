---
"@kumikijs/compiler": minor
"@kumikijs/runtime": patch
"@kumikijs/cli": patch
"@kumikijs/vite": patch
---

feat(compiler): `W0212 ui-event-subscription-mismatch` — warn on `ui-event` subscriptions that cannot fire (#143).

When a reducer subscribes to a `ui-event` on a tile that cannot emit it (e.g. `ui.submit(DivTile)` or `ui.focus(NonFocusableTile)`), the compiler now emits `W0212` instead of silently generating a handler the DOM will never invoke. The rule consults the ui-event implicit-lift table (single source of truth in `packages/compiler/src/ui-lifts.ts`) to decide whether the subscription is admissible.

- compiler: `checkReducer` cross-references the target tile's kind against the ui-event's admissible tile set.
- runtime / cli / vite: no behavioural change; the diagnostic surfaces through the standard `check` gate and Vite overlay.
- spec: `docs/spec/errors.md` and `docs/spec/stdlib.md` document `W0212`; `docs/spec/language.md` cross-links to the ui-event lift table.
