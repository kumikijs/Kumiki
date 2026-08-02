---
"@kumikijs/runtime": minor
"@kumikijs/cli": minor
---

feat(runtime,cli): a recorded panic keeps its stack, its `Error.cause` chain,
and where it was caught (#162).

A caught throw was reduced to its message, so the episode log said *that*
something panicked and nothing about *where*. Every catch site now routes
through `panicInfo(e, category)`, which captures `.stack`, walks `Error.cause`
into a JSON-safe chain (depth-capped at 8, cycle-safe), and tags the origin —
`reducer` / `effect` / `capability` / `tile-render` / `hydrate` / `unknown`.

The fields ride along as optional keys on the episode log's panic step, so logs
written before this still parse and the reserved categories can be wired to new
catch sites without a schema break. SSR's reducer path and the replay executor
carry the same fields as the live path, and `kumiki replay` renders a panic as a
`[panic:<category>]` header with indented stack and `Caused by:` blocks, falling
back to the single-line form for older logs. `reportPanic`'s
`[kumiki] panic in …` header is unchanged, so smoke/scenario greps still match.

Spec: `docs/spec/runtime.md` §10.5.1, `docs/spec/lifecycle.md` §7.2.3 — including
the forward-compat contract that stack and cause stay in the episode log and
never reach a reducer's `$event` payload.
