---
"@kumikijs/compiler": patch
---

A `fn` with no `->` returns its body's type, `cfg["label"]` has its field's type, and `{}` is checked

Three shapes of value had no type, and `check` compared a value it could not
type with nothing, so every typed position — a slot's initial value, an
assignment, a record field, a `fn` argument, `app.http`'s `base-url` and
`timeout` — took each of them in silence:

```kumiki snippet
type Config = {ms: Int, label: Text}
slot cfg : Config = {ms: 5, label: "x"}
fn greeting() = "hello"
slot n : Int = greeting()      # ok
# reducer:   n := cfg["label"]  # ok
# app.http:  timeout: {}        # ok
```

Now each one is read:

- **A call to a `fn` declared without `->` has the type of its body**
  (language.md §1.8.2, "inferred if omitted"), read with each parameter at its
  declared type. `slot n : Int = greeting()` is
  `E0201 Expected Int but got Text`, and so is a `fn` passed by name as the key
  of `sort-by` when its body has no order. A body whose own type the checker
  cannot decide (a `.map` / `.fold` result, `{}`) still gives no type, and so
  does a `fn` on a loop of calls (E0006): every `fn` on the loop stays untyped,
  whichever is read first.
- **`cfg["label"]` on a record, with a literal key, has the type of the field
  it names**, as `cfg.label` does. A key computed at runtime still has none.
- **`{}` is the empty Map, the empty Set or the empty record**, and is accepted
  where any of the three is declared, whatever fields a record type has.
  Where the declared type is none of them — a primitive, a union, a `List`,
  `Option`, `Result` or `Tuple` — it is
  `E0201 Expected Int but got {}, an empty Map, Set or record` at the `{}`
  (E0202 as an `emit` argument).

The type a `fn` without `->` answers also decides what is read off its call.
`fn withThree(m: Map(Int, Text)) = m.insert(3, "c")` makes
`withThree(names).keys` a `List(Int)`, so its keys read back as numbers — they
were the strings `"1"`, `"2"`, `"3"`, and summing them gave `"0123"`.

**Migration.** A program that wrote one of these shapes where the declared type
does not hold it now fails `check` with E0201 (or E0202) at the value. Declare
the `fn`'s `->` as the type you meant, or fix the value: write `None`, `[]` or a
value of the declared type instead of `{}`, and read the field the type has.
None of the examples or benchmark programs in this repository changes: all
their `fn`s declare `->`, and each `{}` is written where a `Map`, `Set` or
record is declared.
