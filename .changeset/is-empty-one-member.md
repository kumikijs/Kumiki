---
"@kumikijs/compiler": patch
"@kumikijs/runtime": patch
---

`x.is-empty` and `x.is-empty()` now give the same, correct answer on a Map, a Set, a List and a Text (stdlib.md §2.2.3: the parenthesis-free shortcut is the same method).

The two spellings had two unrelated lowerings. The bare one tested `.length`, which a Map does not have, so an empty Map was not empty and `when(todos.is-empty, …)` on a `Map` never showed its empty state. The parenthesised one asked for a Map's size, which is 0 for anything that is not an object, so every Text was empty — `"abc".is-empty()` was `true`. Both now lower to one runtime helper, `isEmpty`.
