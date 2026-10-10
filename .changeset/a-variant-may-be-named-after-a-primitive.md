---
"@kumikijs/compiler": patch
---

Accept a union variant named after a primitive type

A nullary variant spelt like one of the nine primitive types — `Int`, `Text`,
`Bool`, `Unit`, `Float`, `Time`, `Bytes`, `File`, `EffectId` — was a parse
error that named neither the alternative nor the reason:

```
$ kumiki check a.kumiki        # type SortBy = Name | Time | Size
Error: Parse error at 1:22: Unsupported variant form
```

The grammar (language.md) makes a variant any identifier, and the
primitive names are not reserved words, so `Name | Time | Size` declares a
variant called `Time` exactly as `Name | Date | Size` declares one called
`Date`. It now parses and checks, and the variant works everywhere a nullary
variant does: a slot initialiser, `sort := Time`, a `fn` result, a `match`
arm, `sort == Time`, `.show`, an `if` / `when` condition and a scenario
`state`. The same variant with a payload (`Text(Text)`) already worked.

A primitive's name read as a type on its own still means the primitive, in
the same program: `type Stamp = Time`, `slot t : Time`, `At(Time)`,
`{t: Time}` and `Option(Time)` are unchanged, and so is `Time.parse(t)`.

An alternative that is no variant at all — a record, a `nominal` type or a
`… where …` refinement — is still a parse error, and its message now says
which:

```
Error: Parse error at 1:19: Unsupported variant form: a union alternative is a name, optionally with a payload (`Name` or `Name(T, …)`), not a record
```
