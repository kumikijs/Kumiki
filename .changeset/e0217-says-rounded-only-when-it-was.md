---
"@kumikijs/compiler": patch
---

E0217 says an `Int` literal outside the safe range was rounded only when it was, and names one JavaScript holds exactly, such as 2^53, as held exactly

Outside the safe range, -9007199254740991 through 9007199254740991, some
`Int` literals are still held exactly. The message called each of them "not
exactly representable" and "rounded" to itself:

```
$ kumiki check bound.kumiki
error E0217 int-literal-precision at 1:17: Int literal -9007199254740992 is not exactly representable and was rounded to -9007199254740992
```

The bound is unchanged, so ±2^53 is still E0217, but the message now says
what is true of the literal:

> `Int literal 9007199254740992 is outside the safe range -9007199254740991 through 9007199254740991: it is held exactly, but an integer next to it is not`
>
> `Int literal 9007199254740993 is outside the safe range -9007199254740991 through 9007199254740991 and was rounded to 9007199254740992`

The value a rounded literal became is written with every digit, so
`123456789012345678901234567890` is named as rounded to
`123456789012345677877719597056` rather than `1.2345678901234568e+29`.
errors.md says the same of E0217, and stdlib.md's `Int` reading names the
safe range as the one where every integer is held exactly.
