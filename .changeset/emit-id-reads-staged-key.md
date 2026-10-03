---
"@kumikijs/compiler": patch
"@kumikijs/runtime": patch
---

Evaluate a `latest-per-key` key once, at the `emit`

With `policy=latest-per-key(noteKey)`, a reducer that wrote `noteKey := "b"` and
then did `lastId := emit load(x)` kept `"load:a"`, built from the value the slot
had *before* the reducer ran. The dispatcher evaluated the key again after the
reducer's writes were applied, so it registered the request as `"load:b"`.
Handing `lastId` to `emit cancel(...)` then matched nothing in flight and did
nothing, silently. The same happened the other way round when the body wrote the
key slot *after* the emit, and when the emit sat under `let … in` or in a `match`
arm.

`docs/spec/http.md` §6.4 now says when the key is evaluated: once, where the
`emit` runs, seeing the reducer body's writes up to that statement and none
after it. A reducer's emit carries that key to the dispatcher (`EmitSpec.key`,
optional), which runs the request under it, and the `EffectId` the emit yields is
built from the same value. An emit with no key of its own — an `app.init` entry,
or a hand-written `apply` — is keyed at dispatch as before.
