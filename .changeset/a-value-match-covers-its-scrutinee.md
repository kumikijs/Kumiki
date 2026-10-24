---
"@kumikijs/compiler": patch
---

A `match` used as a value has an arm for every value of its scrutinee's type

`n := match c with | Red -> 1 | Green -> 2` over a `Color = Red | Green | Blue`
passed `check`, and with `c = Blue` it evaluated to JS `undefined`: the reducer
wrote `undefined` into the `Int` slot, which dropped out of the state, and the
same `match` in a tile rendered nothing. An `Option` with no `None` arm did the
same. `kumiki check` now reports such a `match` (E0227), naming up to eight of
the values its arms leave out as the patterns that would match them (`Blue`,
`None`, `Some(_)`, `(None, Green)`), in a reducer, a tile, a `fn`, a `let` or an
expression fragment alike. Adding the missing arms or a `_ -> …` arm makes it
check clean.

Where the scrutinee's type cannot be decided (`$el.choice`, the result of a
`fold`), a value no arm matches is now a panic instead of `undefined`, with the
message "No arm of the match at <line>:<col> matches its value":

- In a reducer, its writes roll back and `app.error` runs.
- In a render, a value `match` inside a tile expression, or inside a `fn` a tile
  calls, used to render `undefined` and leave the rest of the page working. Now
  the nearest `error-boundary` shows its fallback, and with none the page is
  replaced by the panic view. `app.error` does not run for a render panic.

A `match` statement in a reducer body, and a `match` written in tile position
whose arms are tiles, are not values and are unchanged: with no arm for the
value, the statement runs no arm and the tile renders an empty `text`.
