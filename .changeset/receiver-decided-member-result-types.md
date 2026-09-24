---
"@kumikijs/compiler": minor
"@kumikijs/runtime": patch
---

The result type of a member the receiver decides is now resolved, so its value can no longer land in a slot of another type unreported (#383).

A member whose result was built out of the receiver's own type argument had no type at all. So `xs.head` on a `List(Int)` resolved to nothing, and `n := xs.head` put an `Option(Int)` into a slot declared `Int` with `check` saying `ok`. From there every reader disagrees with the slot: `is-some` is false on a value that is present, and `match` finds no arm. `t := opt.is-some` and `n := xs.get(0)` were the same gap.

All of them resolve now, and **both spellings answer the same type** — `xs.head` parses as a field access and `xs.head()` as a method call (`stdlib.md` §2.2.3's parenthesis-free shortcut). Where a member has two readings the argument count tells them apart, as it already did for `.get-or`.

What resolves, from `stdlib.md` §2.2:

- a fixed `Bool` — `is-empty`, `is-some`, `is-none`, `is-ok`, `is-err`, `has`, `contains`, `starts-with`, `ends-with`
- a fixed `Int` — `length` on a `List` / `Text`, `size` on a `Map` / `Set`
- an `Option` of the receiver's own element — `List.get(i)`, `head`, `last`, `find`
- the receiver's own type back — `tail`, `push`, `prepend`, `concat`, `slice`, `reverse`, `sort`, `sort-by`, `unique`, `filter`, `insert`, `remove`, `update`, `merge`, `add`, `toggle`, `union`, `intersect`, `diff`, `or`, and `Text`'s `upper` / `lower` / `trim` / `replace`
- a different container — `Map.keys` / `values` / `entries`, `Set.to-list`, `Option.to-list`, `Result.to-option`, `List.chunk`, `Text.split`
- a `Text` — `List.join`
- an `Option` of a parsed number — `Text.parse-int` / `parse-float`
- `Result.get-err`, which answers the error type rather than the ok one

`.get` on a `List` is among these: it resolved for `Map` / `Option` / `Result` and not for `List`, though §2.2 gives all four.

`.get`'s argument count is now decided by its receiver too. `Map(K, V).get(k)` and `List(T).get(i)` take one; `Option(T).get` and `Result(T, E).get` take none and unwrap. A count that does not fit the receiver is reported (E0213) and names the reading the written count would have selected — where `o.get()` used to be told it "expects 1 argument(s)", which is the `Map` reading's count, and `o.get(1)` was reported by nothing.

Left undecidable on purpose: `map`, `flat-map`, `fold` and `map-err`, whose result a lambda body decides rather than the receiver; `pow`, which has no fixed result at all (§2.2.7); and a receiver whose own type the checker cannot decide. An undecidable result is checked against nothing, while a wrong one reports a program that works.

The `Time` (§2.2.8) and `Duration` (§2.2.9) members are a family of their own and are not included: they answer in each other's types rather than in a type argument, and `Duration` is a nominal over `Int` rather than a primitive.

**Runtime**: `List(T).find(pred)` now returns `Option(T)`, as §2.2.3 has always said. It returned the raw element, or `undefined` when nothing matched — which is neither `Some` nor `None`, so `.is-some` on it was false whether or not an element was found and `match` found no arm. The spec's own example (`language.md` §1.8.4, `p.tags.find($1 == t).is-some`) was affected.

Refs #383.
