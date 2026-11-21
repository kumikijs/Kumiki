---
"@kumikijs/compiler": patch
---

A `retry=` count, a property-test `count`, a motion's `duration` and `iteration`, and the length `len-eq` / `len-lt` / `len-gt` take are refused when written with a point, such as `count = 1.0`, as `0.5` already was, where they passed `check` and were built as whole numbers

Each of these took the number JavaScript read the literal as, so `1.0`, and
`0.99999999999999999`, which is read as `1`, passed:

```kumiki
effect loadQuote cap=http.get in=Unit out=Result(Text, HttpError)
                 retry=linear(1.0, 500ms)
                 map-request={url: "/quote", decode: Decoder.Json(Text)}
```

A literal with a point is a `float`, so each place now gives the error `0.5`
gets there, with the literal as written:

```
$ kumiki check quote.kumiki
Error: Parse error at 2:31: Retry count must be a whole number, 0 or more (got 1.0)
```

The retry count and the property-test count are parse errors at the literal,
`duration: 300.0` and `iteration: 2.0` are E0402, and `len-lt(7.0)` is E0804
(`argument 1 is 7.0`). The same counts written with no point, `1`, `300` and
`7`, are taken as before.
