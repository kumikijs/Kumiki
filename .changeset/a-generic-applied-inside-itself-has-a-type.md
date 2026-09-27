---
"@kumikijs/compiler": patch
---

A generic applied inside itself now has a type the checker compares against.

```
type NonEmpty(T) = T where nonempty
type Short       = Text where len-lt(7)
slot a : NonEmpty(NonEmpty(Short)) = "ku"

reducer setA on=ui.click(BtnA) do= a := 5   # was ok; now E0201
```

Normalisation substituted the argument into the generic's body and walked the
result under the body's re-entry guard, so the inner `NonEmpty` met its own name
and the type normalised to nothing. With nothing to compare against, every write
into the slot was accepted and the runtime held an `Int` in a `Text` slot. The
same happened when a generic was reached again through another generic's
argument: `NonEmpty(Named(Short))` with `type Named(T) = nominal NonEmpty(T)`
lost its nominal, so a different nominal over `Text` went in silently.

An argument is now read under the guard in force where it was written, which is
what codegen's `refinementsOf` already does. A generic that reaches itself
through its own body (`type Loop(T) = Loop(T)`, `type A = NonEmpty(A)`) still
stops where it stopped, and is still E0009's to report.
