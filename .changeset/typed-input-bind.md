---
"@kumikijs/compiler": patch
"@kumikijs/runtime": patch
---

An `input` bound to an `Int` / `Float` / `Time` slot writes a value of that type

`input(bind=age, type="number")` wrote the field's string into the `Int` slot,
so `age + 1` rendered `51`; a `Time` slot bound with `type="date"` became the
string `"2026-03-04"`. The field's text is now read the way `Int.parse` /
`Float.parse` / `Time.parse` read text (the bound position's type, through a
record field or an `Option` payload), and text that spells no value of it is
refused like a refinement violation — the slot keeps its value, the field what
was typed. A `Time` is shown to a date field as `yyyy-MM-dd` (a datetime one as
`yyyy-MM-ddTHH:mm`), and a number field whose text already reads as the slot's
value (`"2.50"` for 2.5) is not rewritten under the caret.
