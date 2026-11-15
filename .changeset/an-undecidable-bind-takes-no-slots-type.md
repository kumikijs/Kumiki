---
"@kumikijs/compiler": patch
---

A name bound to a value whose type cannot be decided no longer takes the type of a slot of the same name

Beside `slot name : Text`, `n := let name = xs.map($1) in name` was a spurious
`E0201 Expected Int but got Text`, and `t := (let name = $event in name).size.show`
a spurious `E0108`. The member was lowered by the slot's type too: beside a
`slot m : Box` with a `size` field, `got := let m = xs.map($1 * 2) in m.size`
wrote `undefined`, where it now writes `3`. Such a bind is now undecidable, as
it already was when no slot shared its name. The same holds for every bind that
can have no type of its own: a `let` statement, a `for` bind, a match-arm
pattern and an effect trigger's later payload binds (`on=e.ok(_, key)`).
