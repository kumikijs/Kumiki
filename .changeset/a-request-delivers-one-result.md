---
"@kumikijs/runtime": patch
---

A throw while an effect's result is being delivered is an error of the app, not a second `.err` for the request

The dispatcher delivered a result inside the same `try` that ran the effect,
so its `catch` also caught what threw while that result was being delivered:
past the body of an `.ok` reducer, in the dispatch of what it emitted, in the
render after it, or in a host's episode logger recording that render. The
request then got a second result, an `.err` carrying `{message}`, which never
went through the effect's `Text` failure. On a storage, session or indexed
effect, whose `.err` binds `$e : Text`, the reducer was handed a record.
`packages/examples/features/261-effect-result-delivered-once`, mounted with an
episode logger that throws once while the render after `loaded` is recorded:

```
before: oks=1 errs=1  problem: [object Object]  app.error:
after:  oks=1 errs=0  problem:                  app.error: effect in effect "loadNote"
```

A request now delivers exactly one result. What throws past a reducer's body
while it runs on that result is reported as a reducer panic is, to
`console.error`, as a `panic` step on the result's episode, and to
`app.error`, under `category: "effect"` with `location: effect "<name>"`. The
effect's other reducers on that result still run. The `catch` covers only the
invoke and its retries, and the err it delivers for a throw goes through the
effect's `Text` failure, so a `Text`-failing effect's `.err` receives a `Text`.

`docs/spec/runtime.md` §10.4.5 states this, and `category: "effect"` is no
longer only reserved.
