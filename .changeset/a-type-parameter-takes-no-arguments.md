---
"@kumikijs/compiler": patch
---

A type parameter written with arguments is now **E0210 `type-arity-mismatch`**, reported once, at the application.

```
type H(T) = {v: T(Int)}
slot h : H(Text) = {v: 1}
# before: E0201 "Expected T(Int) but got Int" at the `1` — or nothing at all, with an
#         application of a name that is no type opaque
# after:  E0210 at `T(Int)`: Type parameter "T" of "H" takes no type arguments, but is written "T(Int)"
```

A type parameter names a type, not a type constructor, so there is nothing to apply. Before, the checker skipped every application whose head was a parameter, and instantiation left that head in place, so `T(Int)` survived into `H(Text)` as an application of a name that is no type: either an E0201 that blamed the value for a type that does not exist, or — once such an application is opaque — no report at all. `T(Int, Text)` and `T()` were the same, wherever in the body they were written: a record field, `List(T(Int))`, `Option(T(Int))`, a variant payload, `nominal T(Int)`, `T(Int) where positive`, `NE(T(Int))`, `B(A)` on `type H(A, B)`, and reached through an alias `type J = H(Text)` or a fn parameter `H(Text)`. A use of such a value (`n := h.v`, `h.v + 1`) adds nothing to the one E0210.

Instantiation now replaces a parameter at the head of an application too, which leaves the application opaque instead of reading the head as whatever top-level type shares the parameter's name. So a parameter that shadows a type is one E0210 as well, where it used to be read as that type: `List(Int)` in `type H(List) = {v: List(Int)}` was checked as the stdlib `List(Int)` (E0201 for `{v: ["x"]}`), `T(Int)` beside a top-level `type T = Int` as that `Int` (E0201 for `{v: "x"}`), and `NE(A)` in `type H(NE, A) = {v: NE(A)}` as a top-level `type NE(X) = X where nonempty`, an E0804 on `H(Text, Int)`.

A bare parameter and a generic applied to one are unaffected: `type H(T) = {v: T}` and `type W(T) = {v: G(T)}` still check a value against the instantiated argument.
