---
"@kumikijs/compiler": minor
---

An `if` or `match` whose branches are an `Int` and a `Float` is a `Float`, and so is a `List` or `Map` literal that mixes them

`if c then 1 else 1.5` had no type, because its branches share no base. Nothing was checked against it, so `n := let v = if c then 1 else 1.5 in v` passed `check` with `n` an `Int` slot. `[1, 1.5]` was a `List` of an undecided element the same way.

An `Int` beside a `Float` is now the `Float` an `Int` widens to, as `1 + 1.5` already was (language.md). That `n := …` is **E0201** `Expected Int but got Float`, and `[1, 1.5]` is a `List(Float)`. An `Int` beside a `Text` still has no type.

This is also what lets `fold` widen through an `if`: `ps.fold(0, if $2 > 2.0 then $1 + $2 else $1)` over a `List(Float)` has a `Float` accumulator.
