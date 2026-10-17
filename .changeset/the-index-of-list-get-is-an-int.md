---
"@kumikijs/compiler": patch
---

The index of `List(T).get(i)` is checked against `Int`, as the index of `xs[i]` already was.

```kumiki
slot xs : List(Int) = [1, 2, 3]
tile App = column(text("g: " + xs.get("0").get-or(-1).show))
```

passed `check` and rendered `g: 1`: the lookup indexes the JS array, which reads the text `"0"` as the property `0`. `xs.get(0.5)` and `xs.get(k)` with `k : Text` or `k : Float` passed too, and answered `None` or the element at whatever the coercion made of the index.

Each of them is now E0201 at the index — `Expected Int but got Text` / `… Float` — from the one check the read `xs[i]` and the write `xs[i] := v` go through, so the three forms agree on every index type: an `Int`, an `Int` expression, a refinement of `Int` and a `nominal Int` pass in all three, and a `Text`, `Float` or `Option(Int)` index fails in all three. A `List` reached through an alias, a `nominal`, a record field, a fn's declared result or a `List` element is checked the same way. A `.get` with a count the `List` reading does not take is still the one E0213, with no argument read as the index. A receiver the checker cannot type, such as the result of a fn with no `->`, is left unchecked, as it is for `xs[i]`.

The key of `Map(K, V).get(k)` is not checked against `K` by this change.
