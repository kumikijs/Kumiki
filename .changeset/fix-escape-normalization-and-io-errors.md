---
"@kumikijs/cli": patch
"@kumikijs/mcp": patch
---

fix(cli, mcp): escape-normalized partial-string repair + structured `writeError` surfacing.

Robustness follow-ups from the prior review round.

- **Escape normalization.** `planPartialStringPatchExplained` compared decoded `TestResult.leaf` values (`\n` as a real newline, `\"` as a quote, …) against raw source-literal bodies (`\n` as two chars). Any Kumiki source literal spelling an escape — `\n \t \r \" \\` — could either silently bail with `no-string-literal-contains-mida` or, worse, splice the divergent middle into the raw body and re-encode, corrupting untouched escapes (e.g. an existing `\n` doubled to `\\n`). The tier now decodes each literal body via a private `decodeKumikiStringBody` helper (lockstep with the lexer's escape set) and does its `midA` comparison, splice, and `kumikiStringLit` re-encode entirely in decoded space, so escapes round-trip canonically.
- **I/O error surface.** The three `writeFileSync` sites in `applyFixPlan` / `runFixFromTest` used to leak EACCES / ENOSPC / EBUSY as raw stacks — asymmetric with the same file's `parseError` / `regressionBlocked` / `testRunError` structured returns. Every write now goes through a new `atomicWriteFileSync` helper (`.kumiki-tmp` staging + `renameSync`) so a mid-write ENOSPC leaves the target byte-identical instead of truncating it. `FixApplyResult` gains an optional `writeError?: string` modifier; `FixFromTestOutcome` gains a `write-failed` variant with `phase: "compile" | "test"` discriminating the two write sites (and preserving the proposed `patch` on `phase: "test"`). `fixCmd` fails loudly on stderr and sets `process.exitCode = 1` on write failure. `kumiki_fix` (MCP) surfaces `writeError` / `regressionBlocked` on the wire alongside `parseError`. `kumiki_auto_patch` documents the new status. Both consumer switches gain `default: never` exhaustiveness guards.
