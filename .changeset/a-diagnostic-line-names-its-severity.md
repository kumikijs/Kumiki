---
"@kumikijs/cli": patch
"@kumikijs/mcp": patch
---

A diagnostic printed as text names its severity

`kumiki check` printed a warning and an error in the same shape, warnings
first, so on a file with one of each nothing on either line said which was
which:

```
W0212 ui-event-tile-mismatch at 2:17: Reducer "bump" subscribes to ui.focus(Card) but …
E0103 undef-ref at 4:30: Reference to undefined name "totl"
```

The `W` and `E` on the codes are a naming convention, not the `severity` field
the JSON forms carry. Each line now leads with that field:

```
warning W0212 ui-event-tile-mismatch at 2:17: Reducer "bump" subscribes to ui.focus(Card) but …
error E0103 undef-ref at 4:30: Reference to undefined name "totl"
```

`build`, `test`, `smoke`, `run` and `replay` print a diagnostic through the
same formatter, so they change the same way. `kumiki fix` printed each
diagnostic as a bare `E0103 Reference to undefined name "totl"`, the one a
patch is proposed for and an error it has no patch for included. It now prints
each as the `check` line above, still with `  fix: …` under a proposal and
`[<reason>]` after an error it has no patch for. Under `fix --auto-patch`, the
compile errors and the errors a refused patch would introduce were indented
under their heading; they now start their line, as the warnings after them do.

The MCP `kumiki_fix` dry run listed its diagnostics without a severity: an
error as `E0103 Reference to undefined name "zzz"`, a proposal as
`E0103: replace "conut" with "count" at 2:45`, an error it has no patch for as
`E0105: Reference to undefined tile "Missing" (no auto-patch)`, and a warning
as `W0212 Reducer "bump" subscribes to …`. It now lists each as `kumiki check`
prints it, with `  fix: replace "conut" with "count" at 2:45` under a proposal
and `(no auto-patch)` still after an error it has no patch for.

`@kumikijs/cli` exports `formatDiagnostic`, which builds that line. Each patch
`planFix` and `planFixesExplained` return is now a `CompilePatch`, which
carries the `diagnostic` it answers, and so does each `SkipReason`, so a caller
can print either the same way.
