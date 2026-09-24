---
"@kumikijs/compiler": minor
---

An `error-boundary` fallback must declare `in=PanicInfo` — anything else is **E0130 `boundary-fallback-input`** at the clause (#394).

A fallback is applied to the panic: codegen binds its `$1` to the `PanicInfo` the runtime builds, whatever the fallback declares (`lifecycle.md` §7.3). Nothing checked that it declared one, so the type the checker gave `$1` was not the value the runtime bound:

```kumiki
tile Fb in=Text = column(text("recovered: " + $1))
tile Risky error-boundary=Fb = column(text("v: " + secret.get))
```

passed `check` and `smoke`, and rendered `recovered: [object Object]`. A fallback declaring no `in=` could not name the panic at all — its `$1` drew E0103's generic hint to declare an `in=`, which led straight to the shape above.

Both are now E0130, reported once per `error-boundary` clause, with a message that names `PanicInfo`. `PanicInfo` has to be assignable to what the fallback declares, so an alias of it is accepted. The same tile rendered anywhere else is an ordinary tile and is unaffected.
