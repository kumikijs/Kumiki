---
"@kumikijs/compiler": patch
"@kumikijs/runtime": patch
---

An `input` bound to an `Int` / `Float` / `Time` slot writes a value of that type

`input(bind=age, type="number")` wrote the field's string into the `Int` slot,
so `age + 1` rendered `51`; a `Time` slot bound with `type="date"` became the
string `"2026-03-04"`. The field's text is now read the way `Int.parse` /
`Float.parse` / `Time.parse` read text — by the bound position's base, through
a record field or, with `.get`, an `Option` or `Result` payload, and through
aliases and nominals — and text that spells no value of it is refused like a
refinement violation: the slot keeps its value, the field what was typed, and
`error(field=…)` says why ("Must be a whole number" / "Must be a number" /
"Must be a date", overridable as `theme.errors.int` / `float` / `time`), on a
slot with no refinement too and before any refinement's message. A `Time` is
shown to a `type="date"` field as `yyyy-MM-dd` (a `type="datetime-local"` one
as `yyyy-MM-ddTHH:mm`), and a field whose text already reads as the slot's
value (`"2.50"` for 2.5) is not rewritten under the caret.

`kumiki check` reports an `input` whose field kind does not go with the bound
type (E0226): an `Int` / `Float` outside `type="number"`, a `Time` outside
`type="date"` / `"datetime-local"` (a `type="time"` field was shown the
millisecond count and could never write), and a type no field reads — a
`Bool`, a record, or an `Option` bound whole rather than through `.get`.
