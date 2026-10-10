---
"@kumikijs/compiler": patch
---

A binding-name arm parses after another arm in a value or statement `match`

A `match` pattern may be a binding name, which matches whatever the arms above
it did not and names it. In a tile `match`, or as the first arm, it parsed. In
a value or statement `match` it did not after another arm: an arm body is an
expression, and the `|` before a lowercase name was read as a bool OR, so the
`->` after the name was a parse error:

```
$ kumiki check bind-arm.kumiki      # fn score(x: Color) -> Int = match x with | Red -> 1 | other -> 2
Error: Parse error at 4:61: Expected a definition keyword
```

`->` is not an operator, so a pattern followed by `->` after a `|` can only be
the next arm, and the parser now reads a binding name there the way it already
read a variant. A `|` with no `->` after what follows it is still an OR, so
`a | b`, `a | b.c` and `a | f(x)` are unchanged:

```
$ kumiki check bind-arm.kumiki
ok
```
