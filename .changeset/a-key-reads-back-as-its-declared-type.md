---
"@kumikijs/compiler": minor
"@kumikijs/runtime": patch
---

A non-`Text` key reads back as its declared type from `Set(T).to-list`, `Map(K, V).keys`, `Map(K, V).entries`, and as the `$1` of a `Map(K, V).filter` predicate (#467).

A Set is stored as `{ [key]: true }` and a Map as a plain object, so their keys are JavaScript object keys — strings. The readers returned them as they were stored, so a `Set(Int)` built with `add` answered `["7", "8"]` under a `List(Int)` type. Every later reader disagreed with it: `contains(7)` was false, `sort` ordered text, `fold(0, $1 + $2)` concatenated, a `for k in m.keys` over a `Map(Int, V)` bound strings, and `m.filter($1 == 3)` kept nothing. `check` and `build` both said `ok`.

The checker now records, on each of those members, how the receiver's key type is represented — a number for `Int` / `Float` / `Time` (and a `nominal` / `where` over one), a boolean for `Bool` — and codegen passes it to the runtime helper, which restores the keys it reads. A `Text` key lowers exactly as before. The storage and `add` / `remove` / `toggle` / `has` are unchanged, and already agree: they key by `String(x)`. stdlib.md §2.2.2 states the rule.

For the receiver's type to be known in more places, two things the checker left untyped now have types:

- **`$1` / `$2` in a fragment** are bound to what the lowering hands it, read off the receiver: the element of a `List` or `Option`, the halves of a `.entries` tuple, a Map's key and value under `filter`, `fold`'s element, `Map.update`'s value. So `rs.map($1.ids.to-list)` restores keys, and a value passed on through them is checked like any other: `xs.map(loud($1))` with `loud(t: Text)` over a `List(Int)` is now E0201. Where the lowering's reading is not certain (an element that is itself a `List` or `Set`, `fold`'s accumulator) nothing is bound, as before.
- **`run-reducer(r)` in a property-test invariant** answers `{slots: {…}}` typed with the program's slots, so `run-reducer(add).slots.st.to-list.contains(7)` no longer reports a counterexample against a correct program, and a slot name the program does not declare is E0108.

**`T.fresh()` on a type a `Text` does not go into is now E0802.** `fresh` mints a uuid `Text` whatever `T` says; on a `nominal Int` the string used to pass silently, and with keys now restored by type a `Set` of such ids read them back as `NaN`. Declare the id `nominal Text`. The E0124 message for `fresh` on a type constructor names that half of the repair too.
