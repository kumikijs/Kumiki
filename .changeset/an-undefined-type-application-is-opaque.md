---
"@kumikijs/compiler": patch
---

An application of a type name that resolves to nothing is now as opaque as the bare name: **E0117 `undef-type`** is its one report.

```
slot x : Foo = 1          # E0117
slot y : Foo(Int) = 1     # was E0117 and E0201 "Expected Foo(Int) but got Int"; now E0117 alone
```

Before, the bare `Foo` accepted every value after E0117, but `Foo(Int)` was compared argument by argument like a stdlib constructor, so the literal was blamed for not matching a type that does not exist. The same second report followed every place the application was written — a fn parameter or result, a record field or variant payload, `List(Foo(Int))`, `Option(Foo(Int))`, an alias `type A = Foo(Int)`, `nominal Foo(Int)`, `Foo(Int) where positive`, `Foo(Int, Text)`, a misspelt `Lst(Int)`, and `Int()` ("Expected Int but got Int") — and every use of such a value: `n := y`, `y + 1`, `y < 1`, `not y`, `if y`, a `match` on `y` (E0208), each now reports nothing beyond the E0117. `T.parse` on an alias of an undefined application (`type Q = Foo(Int)`) is left to the E0117 at the definition rather than adding E0802, as it already was for an alias of an undefined bare name.

A type parameter applied to arguments inside its own definition (`type H(T) = {v: T(Int)}`) names no type either and is opaque the same way; its one report was the same kind of E0201 (`Expected T(Int) but got Int`), and it now has none.

A stdlib constructor and a program's own generic are unaffected: `slot l : List(Int) = ["x"]`, `slot o : Option(Text) = 1` and `G(Int)` with a wrong field for `type G(T) = {v: T}` are still E0201.
