---
"@kumikijs/compiler": minor
---

The result type of a member the receiver decides is now resolved, so its value can no longer land in a slot of another type unreported (#383).

`inferType` resolved three such members — `.get`, `.get-or` and `.copy` — as branches in its `MethodCall` arm, and everything else fell through to `METHOD_RESULT`, a flat name → prim table that cannot express "a `List` of the receiver's own element". So `xs.head` on a `List(Int)` had no type at all, and `n := xs.head` put an `Option(Int)` into a slot declared `Int` with `check` saying `ok`. From there every reader disagrees with the slot: `is-some` is false on a value that is present, and `match` finds no arm. `t := opt.is-some` and `n := xs.get(0)` were the same gap.

One resolver, `receiverMemberResult`, now answers for all of them, and **both spellings ask it** — `xs.head` parses as a `FieldAccess` and `xs.head()` as a `MethodCall` (`stdlib.md` §2.2.3's parenthesis-free shortcut), and resolving those in two places is how the two readings of one member come to disagree. Where a member has two readings the argument count tells them apart, as it already did for `.get-or`.

What resolves, from `stdlib.md` §2.2:

- a fixed `Bool` — `is-empty`, `is-some`, `is-none`, `is-ok`, `is-err`, `has`, `contains`, `starts-with`, `ends-with`
- a fixed `Int` — `length` on a `List` / `Text`, `size` on a `Map` / `Set`
- an `Option` of the receiver's own element — `List.get(i)`, `head`, `last`, `find`, and `Text.parse-int` / `parse-float`
- the receiver's own type back — `tail`, `push`, `prepend`, `concat`, `slice`, `reverse`, `sort`, `sort-by`, `unique`, `filter`, `insert`, `remove`, `update`, `merge`, `add`, `toggle`, `union`, `intersect`, `diff`, `or`, and `Text`'s `upper` / `lower` / `trim` / `replace`
- a container other than the receiver's — `Map.keys` / `values` / `entries`, `Set.to-list`, `Option.to-list`, `Result.to-option`, `List.join` / `chunk`, `Text.split`
- `Result.get-err`, which answers the error type rather than the ok one

`.get` on a `List` is among these: it resolved for `Map` / `Option` / `Result` and not for `List`, though §2.2.3 gives all four.

Left undecidable on purpose: `map`, `flat-map`, `fold` and `map-err`, whose result a lambda body decides rather than the receiver; `pow`, which has no fixed result at all (§2.2.7); and a receiver whose own type the checker cannot decide. An undecidable result is checked against nothing, while a wrong one reports a program that works.

`Time` (§2.2.8) and `Duration` (§2.2.9) are a separate family and are not included — `Duration` is a nominal over `Int` rather than a prim, so its members need a lookup none of these receivers use.

Refs #383.
