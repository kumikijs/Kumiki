---
"@kumikijs/runtime": patch
"@kumikijs/compiler": patch
---

`Map(K, V).map(expr)` maps each entry

`m.map($2 + "!")` did not go through the Map. The polymorphic `.map` helper
knew about Lists, Options and Results, and passed anything else to the
fragment whole, so a `Map(Int, Text)` slot ended up holding the string
`"[object Object]!"`. Both `check` and `build` passed.

`map` now returns a Map with the same keys, and each value becomes `expr`
evaluated with `$1` set to the key and `$2` to the value (stdlib.md §2.2.1).
The key is restored to its declared type the way `keys` and `Map.filter`
restore it, so `m.map($1 * 10)` on a `Map(Int, Int)` is arithmetic, and a
key that is itself a pair, such as a `Tuple(Int, Int)`, is still all of `$1`
with `$2` the value. The
checker binds `$1` / `$2` for `Map.map`, so a fragment that uses them with
the wrong type is reported, and records its fragment as handed the key and
the value, as it does a Map's `filter`: a `fn` of two named there
(`m.map(label)`) takes the key and the value instead of being refused with
**E0213**, and the E0103 / E0213 messages name a Map's map among the places
a `$2` is bound.
