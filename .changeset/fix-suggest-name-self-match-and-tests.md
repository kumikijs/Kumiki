---
"@kumikijs/cli": patch
---

fix(cli): add self-match gate to `suggestNameFrom` and expand `planTestPatch` test coverage (#178).

- `suggestNameFrom` now returns `null` when the closest candidate exactly matches the missing name (Levenshtein distance 0). Previously it would return the self-match, generating a no-op `replace "X" with "X"` patch that relied on the `applied ⇔ source changed` invariant downstream. The gate cuts the class off at the source; the caller now records `no-close-name-suggestion` instead.
- Adds targeted tests to `packages/cli/test/ai-edit.test.ts` for previously-untouched paths in `planTestPatch`:
  - The multiplicative-tier positive branch (`count := count * newN`), which had zero coverage.
  - The `n === 0` side of `multiplicative-zero-guard` (the existing test only exercised `actual === 0`).
  - A distinct instance of `multiplicative-nonintegral-solution` as a canary against future regex narrowing.
  - The `top.length !== 1` bail in `planPartialStringPatch` when both matches sit inside the target scope (rank-0 tie), complementing the existing rank-2 case.
  - `suggestName` distance-threshold canary (`XyzzyPlugh` far from every candidate — no unrelated proposal must slip through).
  - Self-match regression pin for the new gate.
