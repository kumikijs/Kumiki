---
"@kumikijs/runtime": patch
---

`format` reads a `Time` held as text by `Time.parse`'s grammar, so digits are no instant

A `Time` field that a JSON payload filled with text, which `Decoder.Json` does
not convert, was read by `format` with `Number` first and only then by
`Time.parse`. Digits became a count of milliseconds after the epoch, while
`Time.parse` refuses them. With `format("yyyy-MM-dd HH:mm")` on a UTC clock:

```
"1"         rendered 1970-01-01 00:00  (1969-12-31 16:00 in Los Angeles)
"2026"      rendered 1970-01-01 00:00  (two seconds after the epoch)
"20260307"  rendered 1970-01-01 05:37  (the ISO 8601 basic date, as milliseconds)
```

`format` now reads text by `Time.parse`'s grammar alone (stdlib.md §2.2.8),
after trimming the blanks around it, and a `Time` that is a number is the
instant it counts. Text the grammar refuses renders no date, as `"hello 12"`
already did. That includes a numeric string such as `"1772877600000"`: a
`Time` the program writes goes to JSON as a number, never as text.

`Time.parse` reads as before. `"1"`, `"hello 12"`, `"March 7"` and `"Tue 5"`,
which V8's own parser reads as days in 2001, are `None` on every engine, and
stdlib.md §2.2.8 now names them, together with the ISO 8601 forms the grammar
leaves out (a leap second, an hour without minutes, a comma fraction, the
basic format, week and ordinal dates).
