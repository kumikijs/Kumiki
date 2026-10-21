---
"@kumikijs/compiler": patch
---

The bounds of `List(T).slice(start, end)` and the size of `List(T).chunk(n)` are checked against `Int`, as the index of `xs[i]` and `xs.get(i)` already was.

```kumiki
slot xs : List(Int) = [1, 2, 3, 4]
tile App = column(
  text(xs.slice("1", 2).length.show),
  text(xs.chunk("2").length.show),
  text(xs.chunk("x").length.show))
```

passed `check`. `slice("1", 2)` lowers to the JS `.slice("1", 2)`, which converts the text to a number and behaves as `slice(1, 2)`; `chunk("2")` reached the runtime's `Math.floor("2")` and behaved as `chunk(2)`, while `chunk("x")` made it `NaN` and answered `[[]]`. A `Float` such as `slice(0.5, 2)` or `chunk(2.5)` was truncated the same way, and a `Text` or `Float` slot passed as either argument was not reported either.

Each of them is now E0201 at the argument — `Expected Int but got Text` / `… Float` — from the one check `xs[i]`, `xs[i] := v` and `xs.get(i)` go through, so all of these positions agree on every type: an `Int`, an `Int` expression, a refinement of `Int` and a `nominal Int` pass, and a `Text`, `Float` or `Option(Int)` fails. A one-argument `slice(start)` has its start checked the same way. `chunk(0)` and negative bounds are `Int`s and are unchanged. `Text.slice` is not checked by this change.
