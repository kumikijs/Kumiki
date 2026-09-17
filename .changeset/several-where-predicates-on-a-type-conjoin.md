---
"@kumikijs/compiler": minor
"@kumikijs/runtime": minor
---

Conjoin every `where` a type carries, and name the one that refused a value

The grammar lets a type carry more than one `where`, and the parser folds the
first onto the `nominal` node as a property and wraps the rest. Codegen read
exactly one layer, so the outermost predicate was emitted and every inner one
disappeared:

```
type Handle = nominal Text where len-gt(3) where nonempty
```

```js
"h": { value: "abcd", refine: (v) => typeof v === "string" && v.length > 0, … }
```

`h := "ab"` was accepted at runtime by a type that says the value must be longer
than three characters, and nothing reported it — `check` was silent, `build` was
silent, and the emitted descriptor looked well formed.

`language.md` §1.3.1 now states the reading, in both language tracks: the
predicates **conjoin**, and a value is accepted only when every one of them
holds. It is the reading the rest of the compiler already had — the checker
peels every layer to decide nominal identity, and the property-test generator
folds every layer into its bound — so the fix is codegen catching up rather than
the language moving.

The predicates are collected along the edges that lead from a type to the next
name — an alias, a `nominal` wrapper, a `where` — so they accumulate over a name
as well as over one type expression: with `type Short = Text where len-lt(9)`, a
`nominal Short where len-gt(3)` carries both. A type written in terms of itself
terminates the walk rather than looping. (A generic that hands a parameter back,
`type NonEmpty(T) = T where nonempty`, is an edge normalization follows and this
walk does not yet — its refinement is still dropped, tracked separately.)

`refinement-type` is recursive in §1.3.1, but the parser tested for `where`
twice with no loop, so a third one was a parse error against a grammar that
admits any number. It chains now, and the predicates a type can carry are no
longer capped at two.

A conjunction cannot say *which* predicate refused a value, so a slot whose type
carries several now also emits them separately (`refineAll`), ordered as the
chain is read — from the base outward, which inside one type expression is the
order they are written. Both places a predicate is named read it: the rejection
reported for a discarded reducer batch and the `error` tile's message. A
pristine `Text where nonempty where len-lt(7)` field reads "Required" instead of
naming a bound the empty value is well inside, and a write refused by an inner
predicate is reported against that one rather than against the outermost.

**What changes for an existing program.** A type whose predicates were being
dropped is now enforced, which is the fix and is also a behaviour change:

- `type Handle = nominal Short` over a refined `Short` emitted **no** `refine`
  at all and accepted every write; it is checked now, and codegen wraps writes
  to it in `_s.slotWrite` where it did not before.
- `refineKind` used to hold the outermost predicate and now holds the first of
  the chain, so a report that reads it without `refineAll` can name a different
  predicate than it did — for a single-predicate type, the common case, nothing
  moves and the emitted descriptor is byte-identical.
- A type whose predicates contradict each other (`Text where between(1, 5)
  where nonempty` — `check` does not yet reject a predicate against its base
  type) used to work by dropping one of them, and now refuses every value.
