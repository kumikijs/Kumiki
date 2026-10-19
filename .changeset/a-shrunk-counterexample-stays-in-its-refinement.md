---
"@kumikijs/runtime": patch
---

Shrink a property-test counterexample the way it was generated and the way it failed

Shrinking already kept a number inside its bounds and a text above its shortest
length. It now proposes every number and text through one admission test — the
domain the variable's descriptor declares, read from the same fields generation
reads — and covers the refinements it used to leave as generated:

- An `email` or `url` becomes a shorter value of the shape it was generated in,
  one character at a time, down to a letter per word. `for-all = {e: Text where
  email}` with `invariant = e.length > 100` reported the address it generated
  (`{"e":"wsciej@bpqrsh.example.com"}`); it now reports
  `{"e":"j@h.example.com"}`. A `uuid`, whose shape fixes its length, is still
  reported as generated.
- A `one-of` value moves through the literals listed before it, not only to the
  first. Over `one-of("xs", "sm", "md", "lg")`, a property that holds only on
  `"xs"` reported a generated `"md"` or `"lg"` as it was, because the one
  literal it tried, `"xs"`, holds; it now reports `"sm"`.

Shrinking also keeps the way the generated case failed. A case whose invariant is
false shrinks only through cases in which every `run-reducer` ran, and a refused
case only through cases refused the same way — the same reducer, slots and
predicates — reported with the shrunk case's own rejection. With
`count : Int where between(0, 100)`:

```
test dec-stays-above-ten =
    property-test
        for-all   = {n: Int where between(0, 100)}
        given     = {slots: {count: n}, event: {type: ui.click, target: B}}
        invariant = run-reducer(dec).slots.count > 10
```

The generated case is one where `dec` ran, and it used to shrink across into the
one input `dec` refuses:

```
actual:   counterexample (case 1/100): {"n":0} — reducer "dec" was rejected: slot "count" cannot hold -1 (between(0, 100))
```

It now reports `{"n":1}`, the smallest input on which `dec` ran and the invariant
failed. A refused case no longer shrinks into one that runs, or into one refused
for a different slot.
