---
"@kumikijs/cli": patch
---

fix(cli): `kumiki fix`'s arithmetic tier bails on an operand it cannot represent,
rather than splicing a silently-rounded result (#180).

`planArithmeticPatchExplained` guarded with `Number.isFinite`, which a
20-digit operand passes — and the lexer accepts arbitrary digit strings, so that
operand is reachable from ordinary source. It now guards with
`Number.isSafeInteger` and reports `non-safe-integer-operand`.

Also: the `"(?:[^"\]|\.)*"` string-literal regex, which had been written out
twice, is consolidated into one `iterStringLiterals` helper feeding both
`stringLiteralSpans` and the partial-string tier; and `combinedExcluded`'s
bounds are tightened to `> lo && +len < hi`, which is the "inside the body, not
the quotes" rule it was always meant to express.
