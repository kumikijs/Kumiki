---
"@kumikijs/runtime": patch
---

`run-reducer(name)` in a property-test answers every slot, not only the ones the test gives or the reducer writes

The state `run-reducer` answered was built from `given.slots` plus the reducer's
writes, so a slot the test neither gave nor the reducer wrote read `undefined`
in the invariant. With `slot label : Text = "x"` and a reducer `inc` that writes
only `count`:

```kumiki
test label-alone =
    property-test
        for-all   = {n: Int where between(0, 5)}
        given     = {slots: {count: n}, event: {type: ui.click, target: IncBtn}}
        invariant = run-reducer(inc).slots.label == "x"
```

failed with `counterexample (case 1/100): {"n":0}` against a correct reducer,
while a `reducer-test` of the same reducer saw `label: "x"`. The runtime's
`route` was missing the same way, so `run-reducer(inc).slots.route.path` threw,
which the runner also reports as a counterexample.
A chain (`run-reducer(inc).run-reducer(inc).slots.label`) answered `undefined`
too.

`run-reducer` now answers the whole slot table the reducer ran against — the
declared defaults and the seeded `route`, then `given.slots` — with the
reducer's writes over it.
`reducer-test` and `run-reducer` share that rule, so the two tiers answer the
same state for a reducer whose batch commits. testing.md states it.
