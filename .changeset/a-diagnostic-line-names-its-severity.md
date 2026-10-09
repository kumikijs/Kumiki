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

`build`, `test`, `smoke` and `run` print a diagnostic through the same
formatter, so they change the same way. `kumiki fix` printed its errors and
warnings as a bare `E0103 Reference to undefined name "totl"`; it now prints
them in the `check` line above, as do the error lists under
`fix --auto-patch`. Its proposal lines and the `[reason]` lines for an error
it has no patch for are unchanged.

The MCP `kumiki_fix` dry run listed `E0103 Reference to undefined name "totl"`
and `W0212 Reducer "bump" subscribes to …` one after the other, after
`(no auto-patches available)` or the proposals. It now lists them as
`kumiki check` prints them, `error E0103 …` and `warning W0212 …`.

`@kumikijs/cli` exports `formatDiagnostic`, which builds that line, and
`parseFailure`, the `E0000` diagnostic for a source that does not parse —
`fix`'s regression gate and the MCP tools both build it there.
