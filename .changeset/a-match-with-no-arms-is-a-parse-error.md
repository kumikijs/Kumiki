---
"@kumikijs/compiler": patch
---

A `match` with no arms is a parse error wherever it is written

The grammar gives every `match` one arm or more, but only a `match` read as a
value was held to it. A tile `match` with none passed `check` and `build`, and
the bundle it built was not JavaScript:

```
$ kumiki check zero-arm.kumiki      # tile Pick = match c with
ok
$ kumiki smoke zero-arm.kumiki
SyntaxError: Unexpected token 'else'
```

A `match` statement with none (`reducer r on=ui.click(B) do= match c with`)
passed too, and did nothing when the reducer ran.

The tile, statement and value forms now parse their arms through one rule, so
each of them reports the error the value form already did, at the `match`:

```
$ kumiki check zero-arm.kumiki
Error: Parse error at 3:13: match requires at least one arm
```
