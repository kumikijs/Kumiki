---
"@kumikijs/compiler": patch
---

The `EffectId` that `emit` yields as an expression now reads the key slot the reducer has just written, so `emit cancel(id)` cancels the request the dispatcher is running (#417).

With `policy=latest-per-key(noteKey)`, a reducer that wrote `noteKey := "b"` and then did `lastId := emit load(x)` kept `"load:a"`, which was built from the value the slot had *before* the reducer ran. The dispatcher computes its key after the reducer's writes are applied, so it registered the request as `"load:b"`. Handing `lastId` to `emit cancel(...)` then matched nothing in flight and did nothing, silently.

Both keys now come from one lowering. The only difference between the two call sites is which slot values the key reads, and that is decided by where the key is evaluated.
