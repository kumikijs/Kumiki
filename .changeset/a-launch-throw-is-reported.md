---
"@kumikijs/runtime": patch
---

A throw past an effect's launch is reported as an error of the app under every policy, where a `queue` effect used to drop it

What throws past an effect's launch, outside the reducers its result runs, such
as a host's episode logger as it records the request's `effect-end` or closes
the scope of its result, rejected a promise that nothing handled. Under most
policies that showed up only as an unhandled rejection. Under `queue` the entry
behind it ran as its rejection handler, so the throw was reported nowhere. Under
`queue` and `debounce`, which record a request's `effect-start` at the emit, a
throw there went out of the dispatch that emitted it, reported nowhere.

It is now reported like a throw while a result is delivered: to
`console.error`, to `app.error` under `category: "effect"` with
`location: effect "<name>"`, and as a `panic` step on the episode that claimed
the request, while that episode has not committed. Under `queue` the entries
behind it still run.
