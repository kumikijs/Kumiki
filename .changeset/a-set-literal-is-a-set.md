---
"@kumikijs/compiler": minor
"@kumikijs/runtime": minor
---

A Set literal is a Set (stdlib.md §2.2.2).

A list literal written where a `Set` is declared lowered to a JavaScript array, while every Set member reads a Set as `{ [key]: true }`. So `slot s : Set(Int) = [5]` answered `s.has(5)` with `false`, `[5, 5]` had size 2, `s.add(5)` made the mix `{"0": 5, "5": true}`, and a reducer-test whose `given` / `expect` slots held Set literals compared an array with an object. `check` said `ok`.

The checker marks a list literal it checks against a `Set` type, and codegen builds it with `_s.setOf` (new in the runtime), the same value `add` builds from those members. That is every position the checker reads against a type: for example a slot, a record field, a `fn` parameter or return value, a reducer write, a `let … in` body, an element of a `List(Set(T))` or a value of a `Map(K, Set(T))`, the argument of `List.contains` / `push` / `prepend` and the value of `Map.insert` / `update`, and a test's slot values, expected effect arguments and mocked results. A `<any-id>` member of a Set literal in a reducer-test `expect` pairs with one generated member. Where the checker cannot type the receiver — `$1` in a fragment over a `List(Set(T))` — a literal argument stays an array.

New diagnostics on programs `check` used to accept:
- The argument of `union` / `intersect` / `diff` is checked against the receiver's `Set(T)`: a `List`, a `Set` of another element type or an `Option(Set(T))` there is E0201.
- The argument of `List.contains` / `push` / `prepend` is checked against the element type, and the value of `Map.insert` / `update` against the value type (E0201).
- A test's slot values are checked against the slot's type, an expected effect's argument against its `in=` type, and a mock's payload against its `out=` type (E0201 / E0214 / E0215), as a slot initializer already was.

A Set literal of records or variants now holds what the `add` chain of the same members holds: today those members are keyed by their string form, so `[{x: 1}, {x: 2}]` has one member where the array had two. How structured members are keyed is tracked in #658.
