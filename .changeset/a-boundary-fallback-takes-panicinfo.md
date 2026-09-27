---
"@kumikijs/compiler": minor
---

An `error-boundary` fallback that declares an `in=` must declare one `PanicInfo` fits, and one that reads `$1` must declare one — anything else is **E0220 `boundary-fallback-input`** at the clause (#394).

A fallback is applied to the panic: codegen binds its `$1` to the `PanicInfo` the runtime builds, whatever the fallback declares (`lifecycle.md` §7.3). Nothing checked that it declared one, so the type the checker gave `$1` was not the value the runtime bound:

```kumiki
tile Fb in=Text = column(text("recovered: " + $1))
tile Risky error-boundary=Fb = column(text("v: " + secret.get))
```

passed `check` and `smoke`, and rendered `recovered: [object Object]`. A fallback declaring no `in=` could not name the panic it read — its `$1` drew E0103's generic hint to declare an `in=`, which led straight to the shape above.

Both are now E0220, with a message that names `PanicInfo`. `PanicInfo` has to be assignable to what the fallback declares: `PanicInfo` itself, an alias of it, a `nominal` over it, or a record with exactly its five fields — not a narrower record. The report is attached to the clause, not to the tile: two clauses naming the same fallback are two reports. A fallback that declares no `in=` and never reads `$1` is not reported, so it can still be a route or `sub-routes` target, where an `in=` is E0213.
