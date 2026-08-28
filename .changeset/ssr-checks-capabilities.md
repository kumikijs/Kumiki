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
a host implementation.

**This changes what a deployed app renders** if its `caps` omits a capability
the server pass had been honouring silently: slots that used to arrive
prefilled now serve at their declared defaults, which is what the client
already showed once hydration replaced them. Declaring the capability restores
the old behaviour on both sides.

A refused emit is recorded on the bootstrap episode as an `effect-start`
followed by an `effect-cancel` — the shape a replaced `debounce` timer leaves —
so the pass is accounted for in the record the hydrated client reads and not
only in the server's console. The live path records nothing for the same
refusal under the default policy, where the gate returns before any token is
claimed; the two logs therefore describe one refusal differently, and
`runtime.md` §10.5.1.1 now says so.
