---
"@kumikijs/compiler": patch
"@kumikijs/runtime": patch
---

A Set literal is a Set (stdlib.md §2.2.2).

A list literal written where a `Set` is declared lowered to a JavaScript array, while every Set member reads a Set as `{ [key]: true }`. So `slot s : Set(Int) = [5]` answered `s.has(5)` with `false`, `[5, 5]` had size 2, `s.add(5)` made the mix `{"0": 5, "5": true}`, and a reducer-test whose `given` / `expect` slots held Set literals compared an array with an object. `check` said `ok`.

The checker marks a list literal it checks against a `Set` type, and codegen builds it with `_s.setOf`, the same value `add` builds from those members. It does so wherever the literal is written: a slot, a record field, a `fn` argument, a reducer write, the argument of `union` / `intersect` / `diff`, and a test's `given` / `expect` slots. The `union` / `intersect` / `diff` argument is now checked against the receiver's `Set(T)`, so passing a `List` there is E0201.
