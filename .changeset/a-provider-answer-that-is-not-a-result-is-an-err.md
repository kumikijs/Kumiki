---
"@kumikijs/runtime": patch
---

A host provider's answer that is not `{kind, value}` is the request's `.err`, naming what came back, where it used to run no reducer and report nothing

A provider answers with `{kind: "ok", value}` or `{kind: "err", value}`. On a
capability other than storage, session and indexed, anything else it returned,
such as `{ok: true}` or a bare string, ran neither `.ok` nor `.err` and printed
nothing. `undefined` or `null` reached `.err` with a `TypeError` about reading
`kind`, and on the server pass it made `renderToString` reject.
`packages/examples/features/297-provider-result-checked`, mounted with a
`telemetry.track` provider that returns `{ok: true}`, after a click on Track:

```
before this change: sent: 0  problem:
now:                sent: 0  problem: Error: the telemetry.track provider returned {"ok":true}, not {kind, value}
```

Such an answer, `undefined` included, is now the request's err, as a throw from
the provider is: a `{message}` naming what came back, and `retry=` does not
attempt it again. The server pass reads it the same way, so an `undefined`
answer no longer rejects `renderToString`.
