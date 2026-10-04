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

After, both forms are E0218, with a remedy that fits the type:

```
E0218 for-over-non-list at 2:28: "for" iterates a List, but this is Option(List(Text)) — iterate its .get-or([]), or match on Some / None
```

- `Option(List(T))` / `Result(List(T), E)`: `.get-or([])`, or a `match`
- any other `Option` / `Result`: a `match`
- `Text`: `.split(sep)`
- `Int`, `Bool`, a record, a union, a `Tuple`, …: the message names the type
- `Map` / `Set`: unchanged — `.keys` (or `.values`) / `.to-list`

A target whose type cannot be decided (a `fn` with no `->`, an untyped
payload, a type that names nothing) and one that already has a diagnostic of
its own stay unreported.

`kumiki fix` reads the accessor to append from the diagnostic's new `accessor`
field (`keys` / `to-list`) rather than from its message, and skips every other
E0218 with `e0218-no-accessor`: what an `Option`'s `None` iterates is the
author's call.
