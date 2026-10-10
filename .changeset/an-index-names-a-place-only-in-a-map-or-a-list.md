---
"@kumikijs/compiler": patch
---

An index write into a receiver that is neither a `Map` nor a `List` is now **E0602 `unassignable-member`**, at the index step, as an index write into a `Set` already was.

A record, a scalar such as `Int` or `Text`, an `Option`, a `Result`, a `Tuple` and a union have no place an index names, so `r["a"] := v`, `n[0] := v`, `o[0] := v` and `xs[0][0] := v` on a `List(Int)` are each reported: `Cannot assign through an index into "Int": an index names a place only in a Map or a List`. On a record, a key written as a literal that is one of its fields adds the step to write instead: `— write the field step ".a"`.

Before, these passed `check` and the right-hand side was checked against nothing. `r["a"] := "oops"` on `type R = {a: Int}` stored the Text in the Int field, so a later `r.a + 1` concatenated, while `r.a := "oops"` was E0201. On an `Int` or a `Text` the write panicked at run time ("Index 0 reaches no List or Map"), and on an `Option` it added a `"0"` key to the Option's value. `Map` and `List` index writes are unchanged, and so is a receiver whose type is not known, which stays silent.
