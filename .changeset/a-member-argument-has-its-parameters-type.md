---
"@kumikijs/compiler": minor
---

A `Map` / `Set` / `List` member's argument has its parameter's type.

`check` compared only a few member arguments with the receiver's type arguments — the element of `List.push` / `prepend` / `contains`, the value of `Map.insert` / `update` and the operand of `Set.union` / `intersect` / `diff` — while the member's result claimed the receiver's type either way. So `ys.concat(["w"])` on a `List(Int)`, `s.add(42)` on a `Set(Text)` and `m.insert(1, 0)` on a `Map(Text, Int)` passed `check`, the slot held a value of another type, and later arithmetic on it went wrong: the fold sum of `[9, "w"]` rendered `9w`.

Every parameter the stdlib.md signatures type by the receiver is now checked, with the rule a slot write uses, and a mismatch is E0201 at the argument naming the expected type:

- the key `K` of `Map.has` / `get` / `get-or` / `insert` / `remove` / `update`, and the `other` of `Map.merge` against the receiver's `Map(K, V)`;
- the element `T` of `Set.has` / `add` / `remove` / `toggle`;
- the `other` of `List.concat` against the receiver's `List(T)` (a list literal there is checked item by item).

What a slot accepts stays accepted: an `Int` into a `List(Float)`, `None` / `Some(x)` into a `List(Option(T))`, `[]` / `{}`, a `Text` as the key of a `Map(TodoId, V)` over `nominal Text`. A receiver whose type the checker cannot decide — the accumulator `$1` of `fold`, a `fn` result with no `->` — has no argument checked. A list literal whose parameter is a `Set` type is built as a Set, as everywhere else the checker reads one against a type: on `slot ss : Set(Set(Int)) = [[1]]`, `ss.has([1])` is `true` where it was `false`, because the argument was an array and the member a Set.

The parameters come from one table beside the per-receiver member table (`RECEIVER_PARAMS` in `stdlib-members.ts`), which lists every member of the three rows.
