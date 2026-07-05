---
"@kumikijs/compiler": patch
---

refactor(compiler): consolidate ui-event implicit-lift table into a single source of truth (#144).

`packages/compiler/src/ui-lifts.ts` is now the sole place that describes which DOM prop each `ui.*` event lifts to and which tile kinds can host it. Both `codegen.ts` (which emits the handlers) and `typecheck.ts` (which validates subscriptions for `W0212`) read from this table instead of duplicating the mapping. Downstream diagnostics stay in lockstep with codegen by construction.

- compiler: `codegen.ts` and `typecheck.ts` de-duplicated against `ui-lifts.ts`.
- tests: new `packages/compiler/test/ui-lifts.test.ts` guards the table shape.
- spec: `docs/spec/errors.md` cross-references the lift table anchor.
