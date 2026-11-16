---
"@kumikijs/runtime": patch
---

A throw after a reducer's batch commits no longer skips its later emits, its `stop-timer`s and the render

Once a reducer's slots were written, the runtime recorded the reducer,
dispatched its emits, ran its `stop-timer`s and rendered, one after another.
A throw in any of them skipped the rest while the slots already held the
batch. A host's episode logger recording the reducer is one source of such a
throw, and the dispatch of an emit is another.
`packages/examples/features/295-reducer-steps-after-commit`, mounted with an
episode logger that throws while it records `save`, after a click on Save:

```
before: stored=0 stamps=0  autosave still firing
now:    stored=1 stamps=1  autosave stopped
```

Each of those steps now runs whatever the ones before it threw. What threw is
handed on once they all have. On an effect's result and on an `app.error`
reducer, each throw is reported. On any other trigger, it goes on to whatever
ran the reducer, as one `AggregateError` when several steps threw.
