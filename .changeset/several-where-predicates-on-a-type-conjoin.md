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

The predicates are collected through the same edges normalization follows, so
they accumulate over a name as well as over one type expression: with
`type Short = Text where len-lt(9)`, a `nominal Short where len-gt(3)` carries
both. A type written in terms of itself terminates the walk rather than looping.

A conjunction cannot say *which* predicate refused a value, so a slot whose type
carries several now also emits them separately (`refineAll`). Both places a
predicate is named read it: the rejection reported for a discarded reducer batch
and the `error` tile's message. A pristine `Text where nonempty where len-lt(7)`
field reads "Required" instead of naming a bound the empty value is well inside,
and a write refused by the inner predicate is reported against that one rather
than against the outermost. A type with a single predicate emits exactly what it
did before.
