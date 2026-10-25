---
"@kumikijs/compiler": patch
"@kumikijs/cli": patch
---

Report a `for` over any decided type that is not a List (E0218)

E0218 refused a `Map` and a `Set` and nothing else, so a `for` over an
`Option`, a `Result`, a `Text`, an `Int` or a record passed `check` and failed
where the loop ran. The common case is an `Option(List(T))` iterated without
being unwrapped:

```kumiki
slot loaded : Option(List(Text)) = Some(["a", "b"])
tile App = column(for x in loaded text(x))
```

Before:

```
$ kumiki check app.kumiki
ok
$ kumiki smoke app.kumiki
[mount] [kumiki] error in render: (_live.loaded || []).map is not a function
```

The reducer form threw `object is not iterable` at the first dispatch, and a
`Text` in a reducer was walked character by character.

A `for` over a `Tuple`, which ran as an array, and a reducer `for` over a
`Text`, which walked its characters, are now E0218 too.

After, both forms are E0218, with a remedy that fits the type:

```
E0218 for-over-non-list at 2:28: "for" iterates a List, but this is Option(List(Text)) — iterate its .get-or([]), or match on Some / None
```

- `Option(List(T))` / `Result(List(T), E)`: `.get-or([])`, or a `match`
- any other `Option` / `Result`: a `match`
- `Text`: `.split(sep)`
- `Int`, `Bool`, a record, a union, a `Tuple`, …: the message names the type
- `Map` / `Set`: unchanged — `.keys` (or `.values`) / `.to-list`; an alias of
  one now reads as its name (`Index`), where it read "a Map"

A target whose type cannot be decided (a `fn` with no `->`, an untyped
payload, a type that names nothing) and one with an error reported at it stay
unreported. An error inside the target, such as `idx(rws)`, still leaves E0218
beside it, so `kumiki fix` renaming `rws` is not rolled back for the E0218 that
remains.

A local whose type is undecided now hides the slot of its name. A
`let t = $event.rows` over a `Text` slot `t` was judged as that `Text`, and a
`for` over it was refused; before this change that happened only to a `Map` or
a `Set` slot.

`kumiki fix` reads the accessor to append from the diagnostic's new `accessor`
field (`keys` / `to-list`) rather than from its message, and skips every other
E0218 with `e0218-no-accessor`: what an `Option`'s `None` iterates is the
author's call.
