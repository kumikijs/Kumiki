---
"@kumikijs/runtime": patch
---

Shrink a property-test counterexample inside its refinement

Shrinking read nothing but the value it was handed, so every number went toward
`0` and every text toward `""` whatever the `for-all` declared. A refined type's
counterexample came out as a value its generator never produces:

```
test positive-is-never-negative =
    property-test
        for-all   = {v: Int where positive}
        given     = {slots: {}, event: {type: ui.click, target: B}}
        invariant = v < 0
```

```
actual:   counterexample (case 1/100): {"v":0}
```

That report now reads `{"v":1}`. Each candidate is checked against the domain
the variable's descriptor declares — the same fields generation reads — so a
number moves toward the bound nearest zero (`positive` → 1, `between(5, 10)` →
5), a text toward its shortest allowed prefix, an `email` / `url` toward a
shorter value of the shape it was generated in rather than `""`, and a `one-of`
value toward its first listed literal. A record shrinks field by field and keeps
every field; it used to shrink by dropping fields, down to `{}`.

A `run-reducer` step whose batch a refinement refuses leaves the state it was
given, and shrinking used to take that unchanged state as a smaller
counterexample — walking toward an input the reducer never committed:

```
test dec-stays-above-ten =
    property-test
        for-all   = {n: Int where between(0, 100)}
        given     = {slots: {count: n}, event: {type: ui.click, target: B}}
        invariant = run-reducer(dec).slots.count > 10
```

With `count : Int where between(0, 100)`, this reported `{"n":0}`, where `dec`
is refused. Shrinking now passes over refused cases and reports `{"n":1}`, the
smallest input whose committed state fails. A generated case that is itself
refused is reported as generated, followed by the rejection:

```
actual:   counterexample (case 3/100): {"n":0} — reducer "dec" was rejected: slot "count" cannot hold -1 (between(0, 100))
```

Unconstrained `Int`, `Float`, `Text`, `Bool`, `List`, `Set`, `Map` and `Option`
values shrink exactly as before.
