---
"@kumikijs/compiler": patch
---

An arm a nested `match` can never reach, because it took the arms written after it, is now warned as W0219 `unreachable-nested-arm`, and E0227 says when the `match` that ends its last arm takes the arms after it

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

> ``The arm `_` can never be reached: it belongs to the match at 1:56, whose arms above it already match every value. That match ends an arm of the match at 1:34, so it takes every arm written after it. To give this arm to the match at 1:34, put the inner match in parentheses: `(match … with …)` ``

A statement is closed off by putting the arm's statements in braces, ending
with the inner `match` (`-> { … match … with … }`), since braces open a block
only at the start of an arm's body. A tile has no parentheses, so the message
says to move the inner `match` into a tile of its own. When a value `match`'s
last arm ends in a `match` nothing closes off, E0227 adds that that `match`
takes every arm written after it and says to put it in parentheses first. The
added sentence names no position, so `kumiki fix` still matches the error after
a fix moves the lines. A `match` closed off this way, and a `match` that ends
no other `match`'s arm, are not reported, whatever arms they hold.

W0219 alone does not stop a build: a statement or tile `match` with such an arm
still builds, since either may leave values out, and `check` now warns at the
arm.
