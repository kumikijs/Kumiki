---
"@kumikijs/runtime": patch
"@kumikijs/cli": patch
---

Mark a boundary-caught panic as handled, and open the dev overlay only for a panic nothing handled

A panic an `error-boundary` caught is recorded as a `tile-render` `panic` step,
and the `kumiki dev` panel opened its full-screen overlay whenever the latest
episode's last step was a `panic`. Nothing on the step said the program had
handled it, so the overlay's answer came from where the step sat. A click whose
reducer wrote no slot records no `signal-update` after the render, so a caught
panic was the last step and the overlay covered a page that was showing its
fallback:

```
steps: [reducer noop] [panic get called on None @ Risky]   status: panic
overlay: Kumiki panic — Risky — get called on None
```

The same rule missed panics nothing handled. A reducer that writes the slot
that makes a tile panic records a `signal-update` after the panic, and an
`app.error` reducer records its own steps after a reducer panic; in both the
panic was not the last step, and no overlay opened:

```
steps: [reducer doReveal] [panic get called on None @ render] [signal-update]
overlay: (none)
```

A `panic` step now says whether it was handled. One an `error-boundary` caught
carries `handled: true`, on the live path and in a server-rendered bootstrap;
every other panic step carries no `handled` field, and a step without it is a
panic nothing handled. The episode is still `status: "panic"` either way: the
status says the episode holds a panic step, and the field says whether anything
handled it. `@kumikijs/runtime` exports the rule as `isUnhandledPanic(step)`,
with the `PanicStep` type.

The dev panel asks that rule, for the first such step anywhere in the latest
episode:

```
steps: [reducer noop] [panic get called on None @ Risky (handled)]
overlay: (none)

steps: [reducer doReveal] [panic get called on None @ render] [signal-update]
overlay: Kumiki panic — render — get called on None
```

A reducer panic an `app.error` reducer was told about now opens the overlay
too: `app.error` does not handle a panic, which is still reported to the
console `smoke` fails on. The timeline lists a handled panic's step, marked
`(handled)`. `runtime.md` §10.5.1 defines the field and §10.7 the overlay, in
both language tracks.
