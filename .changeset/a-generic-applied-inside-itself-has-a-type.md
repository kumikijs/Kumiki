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

The same normal form is what the rest of the checker reads, so the fix reaches
further than a slot's own writes: the elements of a `List(NonEmpty(NonEmpty(Short)))`,
a fn's argument and return value typed that way, and a `match` on a scrutinee
typed `Alias(Alias(LR(Int)))` — where the payload a pattern binds now has its
type, and a variant the union does not have is E0209.

A generic nominal applied inside itself keeps its whole chain. With
`type Tag(T) = nominal T`, a `Tag(Tag(Cents))` is accepted where a `Cents` is
required and compares with one (`c := n`, `n == c`), exactly as a `Tag(Cents)`
is, and is still refused where a different nominal is.

A generic that hands its parameter back is taken in one step rather than by
expanding its body, so a chain of definitions that each apply the one below
twice (`type D1(T) = D0(D0(T))`, …) is checked in linear time instead of
walking the bottom definition 2^k times. The same classification now sees
through such a generic when it looks for an alias that is its own argument:
`type A = D1(A)` is E0009, as `type A = D0(A)` already was.
