---
"@kumikijs/compiler": minor
"@kumikijs/cli": minor
---

feat(cli,compiler): E0106 and E0209 are auto-patchable again, each from its own
scoped candidate set (#176).

Both were pulled out of `kumiki fix --auto-patch` when it turned out their
did-you-mean fell back to the top-level definition list — a scope that has
nothing to do with either diagnostic, and that could rewrite `stop-timer("x")`
to an unrelated identifier. They return with candidates drawn from the right
namespace instead:

- **compiler** exports two pure AST walkers, `collectTimerNames` and
  `variantTagsOf`. Both read a `Program` without re-typechecking it.
- **cli** generalises `suggestName` to any candidate iterable, wires E0106 to
  the timer names and E0209 to the scrutinee union's variant tags — `Option` and
  `Result` built-ins plus user `TypeDef` bodies, resolved through alias, nominal
  and refinement wrappers.

The auto-patch coverage table flips both back to `yes`, and the scope-safety
invariant (a top-level name is never picked when only a timer or variant scope
is valid) is pinned by tests rather than by the doc comment alone.
