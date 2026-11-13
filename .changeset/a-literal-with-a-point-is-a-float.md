---
"@kumikijs/compiler": minor
---

A number literal written with a point is a `Float` whatever number it is read as, so `slot n : Int = 0.99999999999999999` is E0201 where it passed `check` and was built as `1`

The checker typed a number literal by the number JavaScript read it as, which
is a whole one for `1.0`, and also for `0.99999999999999999`, which is read as
`1`:

```kumiki
slot n : Int = 0.99999999999999999
```

```
$ kumiki check n.kumiki
ok
```

`kumiki build` wrote the slot as `1`. language.md's grammar makes a literal
with a point a `float`, and errors.md reports one where an `Int` is required
as E0201, as `0.5` already was. The checker now reads the literal as written,
in a typed position and where no type is declared alike:

```
error E0201 type-mismatch at 1:16: Expected Int but got Float
```

So `1.0` and `0.0` are `Float`s: `slot n : Int = 1.0`, `fn f(i: Int) -> Int =
i + 1.0` and `timeout: 0.0` in `app.http` are now E0201, and a `List(Float)`
can start from `[0.0]`. A literal with no point is an `Int` whatever it is
read as, so one too long for a double (309 digits or more) is E0217, rounded
to `Infinity`, rather than E0201.
