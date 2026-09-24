---
"@kumikijs/compiler": minor
"@kumikijs/runtime": patch
---

A non-`Text` key reads back as its declared type from `Set(T).to-list`, `Map(K, V).keys` and `Map(K, V).entries` (#467).

A Set is stored as `{ [key]: true }` and a Map as a plain object, so their keys are JavaScript object keys — strings. The three readers returned them as they were stored, so a `Set(Int)` built with `add` answered `["7", "8"]` under a `List(Int)` type. Every later reader disagreed with it: `contains(7)` was false, `sort` ordered text, `fold(0, $1 + $2)` concatenated, and a `for k in m.keys` over a `Map(Int, V)` bound strings. `check` and `build` both said `ok`.

The checker now records, on each of those readers, how the receiver's key type is represented — a number for `Int` / `Float` / `Time` (and a `nominal` / `where` over one), a boolean for `Bool` — and codegen passes it to the runtime helper, which restores the keys it reads. A `Text` key, and a receiver whose type cannot be decided, lower exactly as before. The storage and `add` / `remove` / `toggle` / `has` are unchanged, and already agree: they key by `String(x)`. stdlib.md §2.2.2 states the rule.
