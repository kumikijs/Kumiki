---
"@kumikijs/compiler": minor
---

A `filter` / `map` / `find` / `sort-by` fragment binds `$1` / `$2` from the receiver's type, not from the length of each value (`stdlib.md` §2.2.3).

The lowering used to take apart any value that was an array of exactly two items, so a two-item `List` element, or an `Option` holding one, bound `$1` to its first item:

| Expression | Was | Is |
|---|---|---|
| `Some([1, 2]).filter($1.length > 1)` | `None` | `Some([1, 2])` |
| `Some([1, 2]).map($1.length)` | `{"_tag":"Some"}` | `Some(2)` |
| `[[1, 2], [3, 4, 5]].map($1.length)` | `[null, 3]` | `[2, 3]` |
| `[[1, 2], [3, 4, 5]].find($1.length == 2)` | `None` | `Some([1, 2])` |

The checker now records how each fragment binds and codegen follows it: a `Tuple(A, B)` (what `.entries` produces) is taken apart into `$1` / `$2`, a `Map`'s filter is handed the key and the value, and any other value is `$1` whole. Such a fragment binds no `$2`: `Some(7).filter($2 > 5)` quietly read `$1` again, and `xs.map($2)` read the index; both are now **E0103** with a message saying the fragment is handed one value. Only a receiver whose element type the checker cannot decide keeps the run-time fallback.

With `$1` bound to the element whole, the checker types it too, so an element that is itself a `List` or `Set` is checked like any other value, and a key reader on it restores its keys.
