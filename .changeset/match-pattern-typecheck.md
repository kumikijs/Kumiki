---
"@kumikijs/compiler": minor
---

feat(compiler): check `match` patterns against the scrutinee type (#123).

`match` arms are now typechecked: each pattern must be compatible with the type of the scrutinee, and the arm set must be exhaustive over that type. Non-matching arms are rejected before codegen so a "runs but never fires" arm can no longer slip through.

- compiler: `packages/compiler/src/typecheck.ts` gains a per-arm pattern check that unifies the pattern with the scrutinee type; nominal-type mismatches, tuple-arity mismatches, and record-key mismatches all report structured diagnostics.
- examples: new `packages/examples/features/50-match-pattern-integrity.kumiki` exercises both the positive and negative cases.
- spec: `docs/spec/errors.md` gains the new diagnostic codes for pattern-scrutinee mismatch.
