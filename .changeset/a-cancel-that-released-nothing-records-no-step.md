---
"@kumikijs/runtime": patch
---

An `http.cancel` that released nothing records no `effect-cancel` step

Every `emit cancel(id)` with a non-empty id wrote
`{"kind": "effect-cancel", "targetId": id}` on the episode that emitted it,
whether or not anything answered to that id. A cancel of a request that had
already completed, of an id no request ran under, of a `debounce` emit a later
one had replaced, or of a `throttle` request that had completed while its
window was still open left a step saying the id was cancelled, while nothing
had been aborted. The episode log is the first thing read when a cancel did
not work, and it said the cancel had.

The step is now written only when the cancel released what its id names: it
aborted a request in flight (a request waiting between `retry` attempts is in
flight), removed a `queue` entry still waiting, or cleared a pending
`debounce` timer. A cancel that matched nothing records no step; the reducer
step's `emits` still shows the cancel was emitted. A `throttle` window marker
is not a pending launch, so a cancel that finds only that window open matched
nothing. The other `effect-cancel` steps — a pending launch released on the
episode that claimed it (by a cancel, a replaced `debounce` timer, unmount, or
a refused capability) — are unchanged. `docs/spec/runtime.md` §10.5.1 and
`http.md` §6.4.1 state the rule.
