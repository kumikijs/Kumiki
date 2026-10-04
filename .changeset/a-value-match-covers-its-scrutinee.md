---
"@kumikijs/compiler": patch
---

A `match` used as a value has an arm for every value of its scrutinee's type

`n := match c with | Red -> 1 | Green -> 2` over a `Color = Red | Green | Blue`
passed `check`, and with `c = Blue` it evaluated to JS `undefined`: the reducer
wrote `undefined` into the `Int` slot, which dropped out of the state, and the
same `match` in a tile rendered nothing. An `Option` with no `None` arm did the
same. `kumiki check` now reports such a `match` (E0227), naming each value its
arms leave out as the pattern that would match it — `Blue`, `None`, `Some(_)`,
`(None, Green)` — in a reducer, a tile, a `fn`, a `let` or an expression
fragment alike. Adding the missing arms or a `_ -> …` arm makes it check clean.

Where the scrutinee's type cannot be decided (`$el.choice`, the result of a
`fold`), a value no arm matches is now a panic instead of `undefined`: the
reducer's writes roll back and `app.error` runs with "No arm of the match at
<line>:<col> matches its value". A `match` statement in a reducer body and a
`match` in tile position are unchanged.
