---
"@kumikijs/compiler": minor
"@kumikijs/cli": patch
---

A type-member call qualified by a type constructor is now reported, as the new [E0126 `type-constructor-qualifier`](https://github.com/kumikijs/Kumiki/blob/main/docs/spec/errors.md#e0126-type-constructor-qualifier) (#432).

`List`, `Map`, `Tuple` and a `type Box(T) = …` name types but are not types on their own: they still want their type arguments. So `Box.fresh()`, `List.fresh()` and `Map.parse(t)` have no type to mint or read into, and each existing check declined them on its own terms. E0117 did not fire because the name *is* a type's, E0116 did not fire because the callee resolves, and E0201 had nothing to compare. `slot n : Int = Box.fresh()` stored a uuid string in an `Int` slot with nothing reported.

The call is now E0126, for `fresh`, `parse` and `show` alike, and `Tuple` is covered: variadic is still not zero. The repair is to name the application as a type, as in `type IntBox = Box(Int)` then `IntBox.fresh()`. A qualifier that is already a complete type answers exactly as before.

**CLI**: `kumiki fix` records the skip reason `e0126-type-arguments-unknown` for it. Which arguments to apply is the author's choice, so it proposes no patch.
