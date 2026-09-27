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

The handler now reads the request. `Unit` clears the storage, a record with no
`value` field removes the key (a later read answers `None`), and a record with
a `value` field writes it, whatever the value is. Codegen passes the
`map-request` record through as built, instead of rebuilding it as
`{key, value}` and so always giving it a `value` field.
