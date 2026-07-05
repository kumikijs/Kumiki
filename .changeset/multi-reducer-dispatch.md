---
"@kumikijs/compiler": minor
---

feat(compiler): dispatch every reducer matching the same `ui-event` in source order (#124).

Previously, when two reducers subscribed to the same `ui.click(SameTile)` (with distinct `where=` guards, for example), codegen wired only one and silently dropped the other. Multiple reducers matching the same ui-event now **all** fire, in the source order they appear.

- compiler: `packages/compiler/src/codegen.ts` emits a per-tile handler that iterates every matching reducer instead of overwriting the previous binding.
- examples: new `packages/examples/apps/11-multi-subscribe` demonstrates fan-out subscription semantics.
- spec: `docs/spec/language.md` §1.6 clarifies the "all matching, in source order" dispatch rule.
- tests: `packages/tests/scenario.test.ts` gains a fan-out regression.
