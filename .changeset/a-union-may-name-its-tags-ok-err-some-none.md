---
"@kumikijs/compiler": patch
---

A union's own `Ok` / `Err` / `Some` / `None` stays that union's through a `let`

Variant names are identifiers and none of these four is reserved, so
`type Health = Ok | Degraded | Down` is a valid union. A direct write checked,
but the same value through a `let` or a list literal was refused, because the
checker read those four tags as `Option` / `Result` without looking at the
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
`let x = [Ok(1)]` into a `List(Outcome)`; a `match` on such a `let` reported
the union's other arms as E0209. All of them check now.

Where nothing declares a type, one of these four tags is now read as an
`Option` or a `Result` unless a variant of the program's own could hold the
value — a variant of the same name, written in a `type` or in any other type
the program writes, with as many payloads, each admitting the one written.
Then the place the value lands decides, the way it already did for every
other tag of a user union. Nothing changes where no such variant exists:
`let o = Some(1)` written into an `Int` slot is still E0201, and so is
`let o = Ok(1)` beside `Health`, whose `Ok` carries nothing. Beside
`type Outcome = Ok(Int) | Fail`, `let r = Ok(1)` lands in an `Outcome` slot
and a `Result(Int, Text)` slot alike.

Where a variant of the program's own could hold the value, the `let`-bound name
is no longer typed, as one bound to `Degraded` already was not. So a wrong
destination is reported only where the tag is written directly: `let x = Ok`
written into an `Int` slot passes `check`, while `n := Ok` is still E0201. The
value the runtime builds is the same `{_tag: "Ok"}` either way. The one place
the missing type shows at run time is a `let`-bound `Map` literal keyed by such
a tag (`{Some(1): 2}` beside `type Pick = Some(Int) | Nothing`): its `.keys`
come back as text, as they already did for a `Map` literal keyed by any other
tag of a user union.

Language §1.3.2 states the rule in both language tracks, and
`packages/examples/features/217-user-union-ok-err-tags.kumiki` writes a union's
`Ok` and `None` through a `let` beside a `Result`'s `Ok`, with a scenario that
asserts the `match` arm each one selects.
