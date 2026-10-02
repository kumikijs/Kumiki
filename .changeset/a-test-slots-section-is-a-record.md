---
"@kumikijs/compiler": patch
---

A test's `slots` section that is not a record is now **E0713**, like the clause
around it.

```
test t =
    reducer-test inc
        given  = {slots: 41, event: {type: ui.click, target: B}}   # was ok; now E0713 at `41`
        expect = {slots: 41}                                         # was ok; now E0713 at `41`
```

The test seeded no slot and asserted no slot, and `kumiki test` passed it. The
rule now covers a `given`'s `slots` (every kind that has one), a
`reducer-test` `expect`'s `slots`, and an `episode-test`'s `slots-equal`, which
also accepts `from-log`:

```
`given.slots` must be a record, `{<slot>: …}`
`expect.slots` must be a record, `{<slot>: …}`
`expect.slots-equal` must be a record, `{<slot>: …}`, or `from-log`
```

`{}` is still the empty record. The lowering throws the same sentence instead of
evaluating the value, for a caller that skips `check`.
