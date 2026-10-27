---
"@kumikijs/compiler": patch
---

A list literal used as the index of a `Map(Set(T), V)` is the Set its key type declares, so `m[[1, 2]]` and `m[[2, 1]]` name one entry.

The index literal was built as an array, keyed in its order, so after `m[[1, 2]] := 7` the read `m[[2, 1]]` panicked, and so did a read with a Set value of the same members; an entry `m.insert([1, 2], v)` wrote was not found by `m[[1, 2]]` either. Now the index is built as the Set stdlib.md describes for every position a `Set` is declared at, and it names the entry `m.insert([2, 1], v)`, `m.has([2, 1])` and `m.get-or([2, 1], d)` name.
