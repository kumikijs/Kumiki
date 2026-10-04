---
"@kumikijs/runtime": patch
---

A `Bytes` or a non-finite `Float` written with `storage-write` reads back as itself

`storage.write` stored `JSON.stringify` of the value and `storage.read` handed
back `JSON.parse` of it. JSON has no form for a `Bytes` (a `Uint8Array`) or for
`NaN` / `Infinity` / `-Infinity`, so a program reading its own value back under
the same type got an object in the `Bytes` field and `null` in the `Float`:

```
Save | localStorage: {"blob":"{\"data\":{\"0\":104,\"1\":105},\"ratio\":null}"}
Load | data=[object Object] ratio= ratio+1=1
```

Both `check` and every runtime tier passed. `session.*` shares the code and did
the same.

A value holding a `Bytes` or a non-finite number anywhere is now stored in a
tagged form (http.md §6.7.2): `~` followed by its JSON, with each `Bytes`
written `{"$bytes": "<base64>"}`, each non-finite number `{"$float": "Infinity"}`
(or `"-Infinity"`, `"NaN"`), and each object key of the value's own that starts
with `$` escaped with one more `$`, so a `Map(Text, V)` key can never be taken
for a tag. The read revives it:

```
Save | localStorage: {"blob":"~{\"data\":{\"$bytes\":\"aGk=\"},\"ratio\":{\"$float\":\"Infinity\"}}"}
Load | data=104,105 ratio=Infinity ratio+1=Infinity
```

Every value JSON can hold is stored as its JSON text exactly as before, and no
JSON text starts with `~`, so keys already in storage read back unchanged, a
`Map` key `"$bytes"` included. An older runtime reading a tagged text answers
the read's `.err` (the text is not JSON) rather than a wrongly typed value.

`indexed.*` needs no tagged form: IndexedDB stores a structured clone, which
keeps a `Uint8Array` and a non-finite number as they are (§6.7.4).
