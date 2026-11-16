---
"@kumikijs/runtime": patch
---

A throw past an effect's launch is reported as an error of the app under every policy, where a `queue` effect used to drop it

What throws past an effect's launch, outside the reducers its result runs, such
as a host's episode logger as it records the request's `effect-start`, rejected
a promise that nothing handled. Under most policies that showed up only as an
unhandled rejection. Under `queue` the entry behind it ran as its rejection
handler, so the throw was reported nowhere.

It is now reported as a throw while a result is delivered is: to
`console.error`, as a `panic` step on the episode that claimed the request, and
to `app.error`, under `category: "effect"` with `location: effect "<name>"`.
Under `queue` the entries behind it still run.
