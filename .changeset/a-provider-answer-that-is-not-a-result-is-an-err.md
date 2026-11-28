---
"@kumikijs/runtime": patch
"@kumikijs/compiler": patch
---

A host provider's answer that is not `{kind, value}` is now the request's `.err`, a `{message}` naming what came back, where an answer such as `{ok: true}` ran no reducer and reported nothing

A provider answers with `{kind: "ok", value}` or `{kind: "err", value}`. On a
capability other than storage, session and indexed, anything else it returned,
such as `{ok: true}` or a bare string, ran neither `.ok` nor `.err` and printed
nothing. `undefined` or `null` reached `.err` with a `TypeError` about reading
`kind`. `packages/examples/features/297-provider-result-checked.kumiki`, mounted
with a `telemetry.track` provider that returns `{ok: true}`, after a click on
Track:

```
before this change: sent: 0  problem:
now:                sent: 0  problem: Error: effect "track" (telemetry.track) resolved to {"ok":true}, not {kind, value}
```

Such an answer, `undefined` included, is now the request's err, as a throw from
the provider is: a `{message}` naming the effect and what came back, and
`retry=` does not attempt it again. An `Error` is written as `Name: message`,
and any other answer as its JSON text, cut at 200 characters. Storage, session
and indexed already failed such an answer with a `Text` that named the
provider, and now write it with the same message. The server pass reads it the
same way.
