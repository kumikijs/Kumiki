---
"@kumikijs/compiler": patch
---

A refinement's number argument past the safe range is E0217 where it stands for an `Int`, as the same literal is as a slot's value

A refinement's arguments were parsed straight to numbers and never checked,
so a bound past the safe range was built as the number it was rounded to:

```kumiki
type T = Int where between(0, 9007199254740993)
```

```
$ kumiki check t.kumiki
ok
```

The build tested `v <= 9007199254740992`. Each number argument of `between`
and `one-of` over an `Int` base, and the count of `len-eq` / `len-lt` /
`len-gt` over any base, is now held to the safe range, and one outside it is
E0217 at the literal, named as written:

```
E0217 int-literal-precision at 1:31: Int literal 9007199254740993 is outside the safe range -9007199254740991 through 9007199254740991 and was rounded to 9007199254740992
```

Over a `Float` base a bound is a `Float` and is not held to the range, as a
`Float` slot's value is not. Over a type parameter its type is not decided
where it is written, and it is not checked either.
