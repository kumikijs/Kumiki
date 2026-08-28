---
"@kumikijs/runtime": patch
---

Apply the capability check on the server render pass

`renderToString` invoked every effect an `init` emit or an effect reducer
named, whether or not its capability appeared in `app.caps`. The live
dispatcher has always refused those, so the effect ran once on the server and
never again after hydration — for an HTTP or storage effect, the difference
between a request issued from the prerender and no request at all.

The server pass now applies the same rule as the live dispatcher, exempting
standard presentation effects the same way (an empty `cap`), and consults the
gate before any host provider so an undeclared capability cannot be answered by
a host implementation. The skipped emit appears on the bootstrap episode as a
start and a cancel — the shape a policy-cancelled launch already leaves — so
the pass is accounted for in the record the hydrated client reads, not only in
the server's console.
