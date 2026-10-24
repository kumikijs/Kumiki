---
"@kumikijs/compiler": patch
---

Refuse a tuple of another length wherever a tuple is required (E0201)

`Tuple(T1, ..., Tn)` is fixed length (stdlib.md §2.1.2), but the type relation
compared two tuples item by item over the declared side, treated a missing item
as agreeing and never looked at an extra one. So a `Tuple(Int, Text)` was
accepted where a `Tuple(Int, Text, Int)` was required, and the other way round:

```kumiki
slot pair   : Tuple(Int, Text)      = (1, "a")
slot triple : Tuple(Int, Text, Int) = (0, "z", 9)

reducer widen on=ui.click(Widen)
    do= triple := pair
```

```
$ kumiki check a.kumiki
ok
```

A tuple is an array at run time and a tuple pattern guards on its length, so
after `widen` the slot held a two-item array and a `match triple with
| (a, b, c) -> …` arm never matched again. The same pair got through as a fn
argument, a fn's result, an `if` branch, and nested in a `List`, `Map`,
`Option` or record (`List(Tuple(Int, Int)) := List(Tuple(Int, Int, Int))`).

Each of those is now E0201:

> `Expected Tuple(Int, Text, Int) but got Tuple(Int, Text)`

A tuple literal of the wrong length was already refused, as
`Expected Tuple(Int, Text, Int) but got a tuple of 2 item(s)`, and still is;
the literal and a tuple-typed value now share one length rule. Tuples of the
same length relate item by item as before, and a `List`, `Map` or user generic
written with too few type arguments is still E0210 alone.

Widening a pair to a triple means building the triple, as
`packages/examples/features/225-tuple-arity.kumiki` does. errors.md E0201 states
the rule (en + ja).
