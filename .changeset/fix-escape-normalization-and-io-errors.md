---
"@kumikijs/cli": patch
"@kumikijs/mcp": patch
---

fix(cli, mcp): escape-normalized partial-string repair + structured `writeError` surfacing (#179).

Two robustness follow-ups from the PR #175 review:

- **I5 — escape normalization.** `planPartialStringPatchExplained` compared decoded `TestResult.leaf` values (`\n` as a real newline, `\"` as a quote, …) against raw source-literal bodies (`\n` as two chars). Any Kumiki source literal spelling an escape — `\n \t \r \" \\` — could either silently bail with `no-string-literal-contains-mida` or, worse, splice the divergent middle into the raw body and re-encode, corrupting untouched escapes (e.g. an existing `\n` doubled to `\\n`). The tier now decodes each literal body via a private `decodeKumikiStringBody` helper (lockstep with the lexer's escape set) and does its `midA` comparison, splice, and `kumikiStringLit` re-encode entirely in decoded space, so escapes round-trip canonically.
- **I6 — I/O error surface.** `writeFileSync` in `applyFixPlan` and both `runFixFromTest` sites (Tier-1 compile write and Tier-2 test write) used to leak EACCES / ENOSPC / EBUSY as raw stacks — asymmetric with the same file's `parseError` / `regressionBlocked` / `testRunError` structured returns. `FixApplyResult` gains an optional `writeError?: string` modifier, and `FixFromTestOutcome` gains a `write-failed` variant with `phase: "compile" | "test"` discriminating the two write sites, plus the proposed `patch` on `phase: "test"`. `printFixFromTest` prints `could not write <compile fix|test patch> for "<name>": <msg>` on stderr and suppresses the misleading `applied N compile fix(es)` header on `phase: "compile"` write failures. The MCP `serialiseFixFromTest` gains the corresponding wire case; `kumiki_auto_patch` documents the new status.
