---
"@kumikijs/compiler": patch
---

A negative `Int` literal outside the safe range is E0217, as the positive one is

E0217 `int-literal-precision` exists so that an `Int` literal JavaScript cannot
represent exactly is reported instead of silently rounded. The sign is part of
the literal (language.md), but the lexer emits it as its own operator, and
the check matched only an unsigned literal. So every negative literal past the
bound passed, in every position the check covers:

```
slot lo : Int = -9007199254740993
```

Before, `kumiki check` said `ok`, and `kumiki build` wrote the slot as
`-9007199254740992`, a value other than the one written.

After, it is reported at the `-`, with the literal named as written:

> `Int literal -9007199254740993 is not exactly representable and was rounded to -9007199254740992` — **E0217**

The same holds wherever a positive literal is reported: a slot, a list item, a
record field, a variant payload, a `fn` argument and a reducer write.
`-9007199254740991`, the most negative safe integer, still passes, and so does
the negation of a name (`n := -n`), which is arithmetic rather than a literal.
