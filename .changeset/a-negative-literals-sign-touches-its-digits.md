---
"@kumikijs/compiler": minor
---

Where only a literal may stand, a negative number's `-` has to touch its digits: `one-of(-1, 0, 1)`, not `one-of(- 1, 0, 1)`

The literal grammar in language.md writes the sign into the literal
(`int ::= '-'? [0-9]+`), but the lexer emits `-` as its own operator and the
positions that take only a literal put it back without asking whether it
touched the number. A space or a line break between them was accepted:

```kumiki
type Sign = nominal Int where one-of(- 1, 0, 1)
reducer tick on=timer(- 1s) do= n := n + 1
```

The first checked clean; the second reported `Duration must be 0 or more
(got -1)`, reading `- 1` as `-1`.

Each of those positions is now a parse error at the `-` that gives the
literal to write:

> `Parse error at 1:38: A negative literal's "-" must touch its digits: write -1`

That covers a refinement argument, a duration (`timer`, `debounce`,
`throttle`, a retry backoff), a retry count and factor, a `theme` or `motion`
value, and a property-test `count`. No spelling changes meaning: `- 1` read
as `-1` before, and `-1` is still what those positions take. In an
expression, `- 1` stays unary minus applied to `1`.
