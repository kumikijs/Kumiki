---
"@kumikijs/compiler": patch
---

A union's own `Ok` / `Err` / `Some` / `None` stays that union's through a `let`

Variant names are identifiers and none of these four is reserved, so
`type Health = Ok | Degraded | Down` is a valid union. A direct write checked,
but the same value through a `let` or a literal it binds was refused, because
the checker read those four tags as `Option` / `Result` without looking at the
program's own unions:

```kumiki
type Health = Ok | Degraded | Down
slot health : Health = Down

reducer recover on=ui.click(Go)
    do= let next = Ok
        health := next
# …the tiles and the app
```

```
$ kumiki check a.kumiki
E0201 type-mismatch at 6:19: Expected Health but got Result(?, ?)
```

The same false E0201 came from `let next = None` into a `type Filter = None |
Tag(Text)`, `let e = Err("bad")` into a `type Step = Ok | Err(Text)`, and
`let x = [Ok(1)]` into a `List(Outcome)`; a `match` on such a `let` with the
union's own arms reported them as E0207 and E0209. All of them check now.

A `let`-bound `Some` / `None` / `Ok` / `Err` is still an `Option` or a
`Result`: its members, operators and fragments are that type's, and
`let o = Some(1)` written into an `Int` slot is still E0201. It is now also a
value of each union the program writes, in a `type` or inline in any type,
whose variant of that name holds it: as many payloads, each admitted by that
variant's payload type, with a generic's parameter checked through the applied
type where the value lands. So `let r = Ok(1)` lands in a `Result(Int, Text)`
slot and, beside `type Outcome = Ok(Int) | Fail`, in an `Outcome` slot, but
not in a `Health` slot, whose `Ok` carries nothing. A `match` reads such a
value as its `Option` / `Result` unless an arm names a tag that type lacks;
then it reads the first union with every arm's tag that holds the value, and
the arms have to cover that union.

language.md, Built-in Generic Types, states the rule in both language tracks,
and `packages/examples/features/217-user-union-ok-err-tags.kumiki` writes a
union's `Ok` and `None` through a `let` beside a `Result`'s `Ok`, with a
scenario that asserts the `match` arm each one selects.
