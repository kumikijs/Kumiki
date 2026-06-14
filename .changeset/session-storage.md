---
"@kumikijs/compiler": minor
"@kumikijs/runtime": minor
---

feat(session): `session-read` / `session-write` effects over `sessionStorage` (#84).

Spec §6.7.4 says `session-*` shares the same shape as `storage-*`, but the runtime only exported the localStorage handlers, so `cap=session.*` effects compiled but had no provider and fell through to the "no provider" error.

- runtime: add `sessionRead` / `sessionWrite` next to the localStorage handlers (one helper does the JSON / Option round-trip for both backends), wire them into `builtinEffects`.
- compiler: dispatch `session.read` / `session.write` to the new handlers in codegen.
- runtime: unavailable backends keep returning a clean `err` (#37 contract), exercised by a SecurityError test.
- examples: new `packages/examples/features/39-effect-session.kumiki` models both `.ok` and `.err` branches end-to-end.
