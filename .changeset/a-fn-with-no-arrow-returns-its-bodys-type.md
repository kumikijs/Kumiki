---
"@kumikijs/compiler": patch
---

A `fn` with no `->` returns its body's type, a record read through a literal key has its field's type, and `{}` against anything but a Map or a Set is an error (E0201, or E0214 for each field a record type requires)

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
  of `sort-by` when its body has no order. A body that is a literal has the
  literal's own type, so `fn ids() = [1, 2]` is a `List(Int)` and
  `slot s : Set(Int) = ids()` is E0201. A body whose own type the checker
  cannot decide (a `.map` / `.fold` result, `{}`) still gives no type, and so
  does every `fn` without `->` on a loop of calls (E0006), whichever of them a
  call reaches first. Nothing is checked against what such a call returns; its
  arguments are still checked against the parameters.
- **`cfg["label"]` on a record, with a literal key, has the type of the field
  it names**, as `cfg.label` does. A key computed at runtime still has none.
- **`{}` is the empty Map, the empty Set, or a record literal naming no
  field.** It is accepted where a `Map` or a `Set` is declared. Against a
  record type each field the type requires is
  `E0214 Record literal is missing field "…"` at the `{}`, as in any record
  literal; a standard effect's argument may still leave out its `Option` and
  defaulted fields. Where the declared type is none of the three — a
  primitive, a union, a `List`, `Option`, `Result` or `Tuple` — it is
  `E0201 Expected Int but got {}, an empty Map, Set or record` at the `{}`
  (E0202 as an `emit` argument).

The type a `fn` without `->` answers also decides what is read off its call.
`fn withThree(m: Map(Int, Text)) = m.insert(3, "c")` makes
`withThree(names).keys` a `List(Int)`, so its keys read back as numbers — they
were the strings `"1"`, `"2"`, `"3"`, and summing them gave `"0123"`.

**Migration.** A program that wrote one of these shapes where the declared type
does not hold it now fails `check` at the value, with E0201 (E0202 as an `emit`
argument, E0214 for a `{}` written for a record). Declare the `fn`'s `->` as the
type you meant, or fix the value: write `None`, `[]` or a value of the declared
type instead of `{}`, and read the field the type has. None of the examples or
benchmark programs in this repository changes: all their `fn`s declare `->`,
and each `{}` is written where a `Map` or a `Set` is declared.
