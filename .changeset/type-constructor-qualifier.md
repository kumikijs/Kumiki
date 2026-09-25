---
"@kumikijs/compiler": minor
"@kumikijs/cli": patch
---

A type-member call qualified by a type constructor is now reported, as the new [E0124 `type-constructor-qualifier`](https://github.com/kumikijs/Kumiki/blob/main/docs/spec/errors.md#e0124-type-constructor-qualifier) (#432).

`List`, `Map`, `Tuple` and a `type Box(T) = …` name types but are not types on their own: they still want their type arguments. So `Box.fresh()`, `List.fresh()` and `Option.show(v)` have no type to work with. For `fresh` and `show`, each existing check declined them on its own terms. E0117 did not fire because the name *is* a type's, E0116 did not fire because the callee resolves, and E0201 had nothing to compare. `slot n : Int = Box.fresh()` stored a uuid string in an `Int` slot with nothing reported. `parse` was already reported, as E0802 "has no reading of a text". That message is wrong for `type Tagged(T) = nominal Text`, whose `type OrderId = Tagged(Int)` parses fine.

The call is now E0124 for `fresh`, `parse` and `show` alike, and `Tuple` is covered: variadic is still not zero. On `parse` it replaces the E0802, which now covers only a complete type with no reading. The repair is to name the application as a type, as in `type IntBox = Box(Int)` then `IntBox.fresh()`. On `parse` the message also says that the applied type needs a base with a reading of a text (Int, Float, Time, Bool, Text or Bytes), so `List.parse` is not sent to `type IntList = List(Int)` only to meet E0802 on the next round. A qualifier that is already a complete type answers exactly as before.

**CLI**: `kumiki fix` records the skip reason `e0124-type-arguments-unknown` for it. Which arguments to apply is the author's choice, so it proposes no patch.
