---
"@kumikijs/compiler": patch
"@kumikijs/runtime": patch
---

A property-test runs every trial on a value of its `for-all` type, and a trial the reducer refused fails.

```
slot pair : Tuple(Text, Int where negative) = ("a", -1)

test put-keeps-the-pair =
    property-test
        for-all   = {p: Tuple(Text, Int where negative)}
        given     = {slots: {pair: p}, event: {type: ui.click, target: PutBtn}}
        invariant = run-reducer(put).slots.pair == p
```

Before, the generator had no `Tuple` case and answered a recursive type, or a
generic applied to an argument, with an unknown descriptor, which it turned into
`null`. `put` was handed `pair = null`, its batch was refused for holding a value
the slot's type does not, the refusal was printed on `console.error` and the
step answered "state unchanged" — so the invariant compared `null` with `null`
and the property passed 100 cases in which the reducer never ran.

After, a `Tuple` is generated element by element under each element's own
refinements, a generic is generated with its argument, and a recursive type with
a way to end (a variant without the recursive payload, an `Option` or a
collection holding it) is generated to a depth of four steps. A type with no
value to build — a `File`, an `EffectId`, a `FormData`, a recursive type with no
finite value, a generic applying itself to a different argument — is refused by
`check` with E0715 `for-all-no-generator` at the `for-all` field, and by codegen
with the same message, instead of being generated as `null`.

A trial whose `run-reducer` batch is refused now fails the property, with the
counterexample and the rejection: `counterexample (case 1/100): {"n":3} —
reducer "inc" was rejected: slot "count" cannot hold 4 (between(0, 3))`. The
refusal is no longer also printed on `console.error`, since the failure carries
it; a reducer-test, which can assert a refused batch, is unchanged. Shrinking a
counterexample stays inside the variable's type (an `Int where between(1, 3)`
shrinks to the bound nearest 0, not to 0), so the value reported is one a trial
could have run on. A generated `Set` or `Map` keys its elements the way the
runtime does, so a record or tuple key is the key the runtime looks up rather
than `String()` of it (`"[object Object]"` for every record).

Migration: a property that passed only because its trials were refused now
fails. The likely case is a `for-all` over a `regex`-refined type, which is still
generated without its pattern, written into a slot with the same refinement.
Give that property a custom generator, or write the case as a reducer-test.
