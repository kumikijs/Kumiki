---
"@kumikijs/cli": minor
---

feat(cli): `kumiki fix --auto-patch` repairs more than an exactly-one-literal
match (#156).

`planTestPatch` gains scope-aware disambiguation, non-string leaves, string
prefix/suffix repair, and reducer arithmetic; `planFixes` gains close-name
suggestions for E0106 / E0107 / E0209 / E0211 and capability injection for
E0301.

Two guarantees came out of the review and are worth stating, because they are
what makes the wider coverage safe to run unattended:

- **Nothing broken reaches disk.** A composed patch that fails to parse, or that
  raises the diagnostic set, is rolled back before the write and reported as
  `regressionBlocked`. The gate compares diagnostics by `code@line:col` rather
  than by count, so a 1-for-1 swap (`E0301` → `E0302` via a typo'd cap) is
  caught rather than counted as an improvement.
- **Suggestions stay in scope.** A did-you-mean is only offered from the
  namespace the diagnostic is about, never from the top-level definition list.
