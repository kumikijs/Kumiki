---
"@kumikijs/compiler": patch
---

Gate a slot on the refinement its generic alias carries

A generic that hands its parameter back with a `where` on it was read as
carrying no refinement at all:

```kumiki
type NonEmpty(T) = T where nonempty
slot name : NonEmpty(Text) = "ada"
```

The slot was emitted with no `refine`, so `name := ""` landed, and `check` and
`build` were both silent. The checker already read `NonEmpty(Text)` as
`Text where nonempty` — a generic applied to its arguments is an edge of the
chain a type denotes (spec/language.md §1.3.6, inv. 2) — and codegen now reads
it the same way. The argument's own predicates come first: `NonEmpty(Short)`
over `type Short = Text where len-lt(7)` names `len-lt(7)` for a value too long
and `nonempty` for an empty one. An argument is read where it is written, so a
generic applied inside itself keeps every predicate too:
`NonEmpty(NonEmpty(Short))` is gated on `len-lt(7)`, `nonempty`, `nonempty`.
