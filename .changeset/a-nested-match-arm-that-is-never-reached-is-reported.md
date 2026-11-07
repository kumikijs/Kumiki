---
"@kumikijs/compiler": patch
---

Warn at an arm a nested `match` takes that can never be reached (W0219), and say in E0227 when the arms after a nested `match` are its own

A `match` written at the end of another's arm takes every `|` arm after it,
the ones laid out for the outer `match` included, and nothing said so:

```kumiki
fn f(x: Color, y: Size) -> Int = match x with | Red -> match y with | Small -> 1 | Large -> 2 | _ -> 3
```

`| _ -> 3` is `match y`'s third arm. As a value, the only report was E0227's
"end with `_ -> …`", which the author had done. As a statement, indented so
that `| _` visibly lines up with the outer arms, `check` said `ok` and a click
ran no arm.

That reading is unchanged, and language.md now states it. It holds whatever
the layout, since line breaks and indentation are not read. An arm the inner
`match` takes after its arms above already match every value is now the
warning **W0219 `unreachable-nested-arm`**, at the arm, in a value, a
statement or a tile `match`:

> ``The arm `_` can never be reached: it belongs to the match at 6:56, whose arms above it already match every value. That match ends an arm of the match at 6:34, so it takes every arm written after it. To give this arm to the match at 6:34, put the inner match in parentheses: `(match … with …)` ``

A statement is closed off in braces instead (`{ match … with … }`). A tile
has no parentheses, so the message says to move the inner `match` into a tile
of its own. When a value `match`'s last arm ends in such a `match`, E0227 adds
that the arms after it are that `match`'s and says to put it in parentheses
first. A `match` closed off this way, and a `match` that ends no other
`match`'s arm, are not reported, whatever arms they hold.

A program with such an arm still builds, since a statement or tile `match` may
leave values out, and `check` now warns at the arm.
