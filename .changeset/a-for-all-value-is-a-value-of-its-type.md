---
"@kumikijs/compiler": patch
"@kumikijs/runtime": patch
---

A property-test generates every `for-all` value in full, `check` refuses a `for-all` type with no value to build (E0715), and a trial whose `run-reducer` batch is refused fails.

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
and the property passed 100 cases in which the batch never committed.

After, a `Tuple` is generated element by element under each element's own
refinements, a generic is generated with its argument, and a recursive type with
a way to end (a variant without the recursive payload, an `Option` or a
collection holding it) is generated to a depth of four steps, a collection inside
it halving its size at each step. A generic reached again under another argument,
or one that swaps its parameters, is generated too. Stacked refinements narrow
each other instead of the last one winning: `n: Pos where between(-5, 5)` over
`type Pos = Int where positive` is between 1 and 5, `Text where len-gt(60)` is
longer than 60, and `Text where email where len-lt(20)` is an email shorter than
20. A type with no value to build — a `File`, an `EffectId`, a `FormData`, a
recursive type with no finite value, a generic that nests a parameter deeper,
refinements no value passes (`Int where positive where negative`) — is refused by
`check` with E0715 `for-all-no-generator` at the `for-all` field, and by codegen
with the same message, instead of being generated as `null`. A type with an error
of its own, or one reaching a definition that has one, is left to that error's
code; a bare `Tuple` is now E0210, since it names no type.

A trial whose `run-reducer` batch is refused now fails the property, with the
counterexample and the rejection: `counterexample (case 1/100): {"n":3} —
reducer "inc" was rejected: slot "count" cannot hold 4 (between(0, 3))`. A trial
that panics or throws carries what it threw the same way (`— panicked: Index 0 is
out of range for a List of length 0`), so it reads apart from an invariant that
is false. The
refusal is no longer also printed on `console.error`, since the failure carries
it; a reducer-test, which can assert a refused batch, is unchanged. Shrinking a
counterexample stays inside the variable's type (an `Int where between(1, 3)`
shrinks to the bound nearest 0, not to 0), so the value reported is one a trial
could have run on. A generated `Set` or `Map` keys its elements the way the
runtime does, so a record or tuple key is the key the runtime looks up rather
than `String()` of it (`"[object Object]"` for every record).

Migration: a property that passed only because its trials were refused now
fails. The likely cases are a `for-all` type wider than the slot it seeds —
`for-all = {n: Int}` written through a reducer into `slot count : Int where
between(0, 10)` — and a `for-all` over a `regex`-refined type, which is still
generated without its pattern, written into a slot with the same refinement.
Generate the inputs the slot accepts (`n: Int where between(0, 10)`); for a
pattern, generate that variable from a `one-of` list of values that match it, or
write the case as a reducer-test.
