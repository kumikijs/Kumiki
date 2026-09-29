---
"@kumikijs/compiler": patch
"@kumikijs/runtime": patch
---

`x.is-empty` and `x.is-empty()` now give the same, correct answer on a Map, a List and a Text (stdlib.md §2.2.3: the parenthesis-free shortcut is the same method).

The two spellings had two unrelated lowerings. The bare one was `x.length === 0 || x === ""`, and a Map has no `length` and is not `""`, so an empty Map was not empty and `when(todos.is-empty, …)` on a `Map` never showed its empty state. The parenthesised one asked for a Map's size, which is 0 for anything that is not an object, so every non-object was empty — `"abc".is-empty()` was `true`. Both now lower to one runtime helper, `isEmpty`.

Receivers outside those three change too: `n.is-empty()` on an Int, Float, Bool or Duration went from `true` to `false`, which is what the bare spelling already answered.
