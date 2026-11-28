---
"@kumikijs/compiler": patch
---

A `between` or `one-of` bound over an `Int` written with a point is now E0201, and one past the largest double E0217, instead of a check against `0.5` or `Infinity`

Only a bound's precision was checked, so two kinds of literal still built a
check that could not mean what was written:

```kumiki
type Small = Int where between(0, 0.5)
type Huge  = Int where between(0, 999…9)   # 310 nines
```

```
$ kumiki check t.kumiki
ok
```

The build tested `v <= 0.5` and `v <= Infinity`, and
`Int where between(0, 9007199254740993.5)` was reported as an `Int` literal
that was rounded. Each is now reported at the literal, named as written:

```
error E0201 type-mismatch at 1:35: Expected Int but got Float: argument 2 of refinement "between" is 0.5, written with a point, but it is written over Int
error E0217 int-literal-precision at 2:35: Int literal 999…9 is outside the safe range -9007199254740991 through 9007199254740991 and was rounded to Infinity
```

A base that becomes `Int` where a generic is applied is judged the same way,
once however often the generic is applied. Over a `Float` base nothing
changes.
