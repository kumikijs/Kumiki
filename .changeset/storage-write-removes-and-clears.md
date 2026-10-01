---
"@kumikijs/runtime": patch
"@kumikijs/compiler": patch
---

`storage-remove` removes its key and `storage-clear` clears the storage

http.md §6.7.2 declares three effects on `cap=storage.write`: a write
(`{key, value}`), a remove (`{key}`) and a clear (`Unit`). The handler only
knew `setItem`. A remove stored `JSON.stringify(undefined)`, which `setItem`
writes as the string `"undefined"`, and reported ok, so every later read of the
key failed to parse. A clear threw destructuring its `Unit` input and always
erred. `session.write` shares the code (§6.7.4), so `session-remove` and
`session-clear` did the same.

A clear is now decided by the declaration: a `storage.write` / `session.write`
effect declared `in=Unit` with no `map-request` calls the new `storageClear` /
`sessionClear` handlers, which empty the whole origin's storage. Every other
write reads the request: a record with no `value` field removes the key (a
later read answers `None`), and a record with a `value` field writes it,
whatever the value is. A request that is not a record (an empty one included,
which a `Map` index that finds nothing also produces), a key that is not a
non-empty text, or a value JSON cannot encode is an `err` that changes
nothing, so a bad request can no longer wipe or corrupt the storage. A failed
Web Storage call is an `err` whose message names the call and the key.

Codegen passes the `map-request` record through as built, instead of
rebuilding it as `{key, value}` and so always giving it a `value` field. This
changes what a host provider for `storage.write` / `session.write` receives:
the request as `map-request` built it (as stdlib.md §2.5 already says), not a
`{key, value}` projection, and no request at all for a clear. A provider that
only implemented `setItem` must now handle a remove and a clear as well.
