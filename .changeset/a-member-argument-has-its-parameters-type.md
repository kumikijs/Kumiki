---
"@kumikijs/compiler": minor
---

A `Map` / `Set` / `List` member's argument has its parameter's type.

`check` compared only a few member arguments with the receiver's type arguments — the element of `List.push` / `prepend` / `contains`, the value of `Map.insert` / `update` and the operand of `Set.union` / `intersect` / `diff` — while the member's result claimed the receiver's type either way. So `ys.concat(["w"])` on a `List(Int)`, `s.add(42)` on a `Set(Text)` and `m.insert(1, 0)` on a `Map(Text, Int)` passed `check`, the slot held a value of another type, and later arithmetic on it went wrong: the fold sum of `[9, "w"]` rendered `9w`.

Every parameter the stdlib.md signatures type by the receiver is now checked, with the rule a slot write uses, and a mismatch is E0201 at the argument naming the expected type:

- the key `K` of `Map.has` / `get` / `get-or` / `insert` / `remove` / `update`, and the `other` of `Map.merge` against the receiver's `Map(K, V)`;
- the value `V` that `Map.update` stores when its function is a `fn` passed by name: that `fn`'s declared return type is read against `V`, as an inline fragment's value already was, so `m.update("k", toText)` with `fn toText(x: Int) -> Text` on a `Map(Text, Int)` is E0201 at `toText`;
- the element `T` of `Set.has` / `add` / `remove` / `toggle`;
- the `other` of `List.concat` against the receiver's `List(T)` (a list literal there is checked item by item).

What a slot accepts stays accepted: an `Int` into a `List(Float)`, `None` / `Some(x)` into a `List(Option(T))`, `[]` / `{}`, a `Text` as the key of a `Map(TodoId, V)` over `nominal Text`. Where the checker cannot decide the receiver's type, no argument is read against a parameter type: the accumulator `$1` of a `fold` from `{}`, a `fn` result with no `->`, and the result of `List.map` / `fold` / `zip`, `Map.map` and `Option.map` / `Result.map`. So `xs.map($1 * 2).push("w")` on a `List(Int)` still passes `check`. A list literal whose parameter is a `Set` type is built as a Set, as everywhere else the checker reads one against a type: on `slot ss : Set(Set(Int)) = [[1]]`, `ss.has([1])` is `true` where it was `false`, because the argument was an array and the member a Set.

Consequences worth knowing before upgrading:

- A Map literal with bare keys is a record, and a record is not a `Map`. `m.merge({a: 1})` on a `Map(Text, Int)` merged the key `"a"` and is now E0201 (`Expected Map(Text, Int) but got {a: Int}`). Write `m.merge({"a": 1})`.
- A `nominal` type's name written as a constructor is a variant tag. On a `Map(ItemId, Text)` over `nominal Int`, `items.insert(ItemId(1), "a")` stored the variant `{_tag: "ItemId", _0: 1}` as the key and is now E0201 (`Expected ItemId but got variant "ItemId"`). Write the base value: `items.insert(1, "a")`.
- A literal receiver's type is the one inferred from the literal, and the argument is read against it. On a `List(Float)`, `[0].concat(prices)` is now E0201 (`Expected List(Int) but got List(Float)`), and `{1: "a"}.insert(2.5, "b")` on a `Map(Float, Text)` is E0201 at `2.5`, as `[1, 2].push(2.5)` already was. Start from the slot instead, `prices.prepend(0)`, or write the whole literal, `{1: "a", 2.5: "b"}`. `[0.0]` does not help: `0.0` is read as an `Int`.
- A lookup now builds a list-literal key or member as a Set, but a write through the accumulator of a `fold` from `{}` still stores the literal as an array, so mixing the two answers differently:

  ```kumiki
  ms := nums.fold({}, $1.insert([3], "c"))   # ms : Map(Set(Int), Text)
  ss := nums.fold({}, $1.add([3]))           # ss : Set(Set(Int))
  # ms.get-or([3], "-") and ss.has([3]) answered "c" and true; they now answer "-" and false
  ```

- A list-literal key of a `Map(Set(T), V)` is now stored as a Set, so it is found in any order: after `insert(["a", "b"], 1)`, `get-or(["b", "a"], 0)` answers `1` where it answered `0`. A key an earlier build stored as an array, in persisted state for example, is a different key and is no longer found.
