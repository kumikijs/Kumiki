---
"@kumikijs/cli": patch
---

fix(cli): skip self-matches in `suggestNameFrom` and expand `planTestPatch` test coverage (#178).

- `suggestNameFrom` now skips a candidate whose Levenshtein distance to the missing name is 0 during the sweep, rather than latching onto it and later bailing. This preserves the "no `replace X with X` no-op patch" guarantee while still surfacing a genuinely close alternative when one exists (e.g., missing `"App"` with candidates `["App", "AppTile"]` now correctly proposes `"AppTile"`). Motivated by defending against transient compiler-message drift or future diagnostics that could legitimately quote an existing def name.
- Adds targeted tests to `packages/cli/test/ai-edit.test.ts` for previously-untouched paths in `planTestPatch`:
  - The multiplicative-tier positive branch (`count := count * newN`), which had zero coverage.
  - The `n === 0` side of `multiplicative-zero-guard` (the existing test only exercised `actual === 0`).
  - A distinct instance of `multiplicative-nonintegral-solution` as a canary against future regex narrowing.
  - The `top.length !== 1` bail in `planPartialStringPatch` for both rank-0 (target scope) and rank-1 (deps scope) ties, complementing the existing rank-2 case.
  - Self-match regression pin (`missing` equals the only candidate) and an alternative-preservation pin (self-match must not eclipse a close alternative).
