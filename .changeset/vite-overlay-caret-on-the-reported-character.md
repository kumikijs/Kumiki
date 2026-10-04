---
"@kumikijs/vite": patch
---

Put the overlay's caret on the character the compiler reports

The compiler counts columns from 1, as `kumiki check` prints them. Rollup's
`loc.column` counts from 0, and Vite builds its code frame on that basis, but
the plugin passed the compiler's column through unchanged. Every error and
warning it reported therefore pointed one character to the right:

```
kumiki check:  E0103 undef-ref at 1:24: Reference to undefined name "nope"

1  |  tile App = column(text(nope))
   |                          ^
```

The plugin now converts the column, for check errors, warnings and lex/parse
errors alike, so `loc` is `{line: 1, column: 23}` and the caret sits under the
`n` of `nope`:

```
1  |  tile App = column(text(nope))
   |                         ^
```
