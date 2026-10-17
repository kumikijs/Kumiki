---
"@kumikijs/compiler": patch
---

An index write into a receiver that is neither a `Map` nor a `List` is now **E0602 `unassignable-member`**, at the index step, as an index write into a `Set` already was.

A record, a scalar such as `Int` or `Text`, an `Option`, a `Result`, a `Tuple` and a union have no place an index names, so `r["a"] := v`, `n[0] := v`, `o[0] := v` and `xs[0][0] := v` on a `List(Int)` are each reported, naming the receiver's type as the program writes it: `Cannot assign through an index into "<T>": an index names a place only in a Map or a List`. On a record, a key written as a literal that is one of its fields adds the step to write instead: `— write the field step ".a"`.

Before, these passed `check` and the right-hand side was checked against nothing. `r["a"] := "oops"` on `type R = {a: Int}` stored the Text in the Int field, so a later `r.a + 1` concatenated, while `r.a := "oops"` is E0201. On an `Int` or a `Text`, `n[0] := v` panicked at run time ("Index 0 reaches no List or Map") and `n["a"] := v` replaced the value with the record `{"a": v}`; on an `Option`, `o[0] := v` added a `"0"` key to the Option's value. A `Tuple` index write, which did write the element, is refused too; replace the Tuple whole. `Map` and `List` index writes are unchanged, however the type is named (an alias, `nominal`, a generic alias, `FormData`), and so is a receiver whose type is not known, which stays silent: a name that resolves to nothing, applied or not, is E0117 where it is written, and the write adds nothing to that.

The Set message now names the receiver's type as written too, `"Tags"` or `"Set(Int)"` rather than `"Set"`.
