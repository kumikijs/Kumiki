---
"@kumikijs/runtime": patch
---

A `Bytes`, a non-finite `Float` or a `-0.0` written through `storage.write` or `session.write` now reads back as itself

`storage.write` stored `JSON.stringify` of the value and `storage.read` handed
back `JSON.parse` of it. JSON has no form for a `Bytes` (a `Uint8Array`), for
`NaN` / `Infinity` / `-Infinity` or for negative zero, so a program reading its
own value back under the same type got an object in the `Bytes` field, `null`
in a non-finite `Float` and `0` for `-0.0`. Example 187
(`packages/examples/features/187-stored-bytes-and-infinity.kumiki`) saves
`{data: Bytes.from-text("hi"), ratio: 1.0 / 0.0}` and loads it back. Before:

```
localStorage "blob": {"data":{"0":104,"1":105},"ratio":null}
shown: same=false data=[object Object] ratio=
```

Both `check` and every runtime tier passed. `session.*` shares the code and did
the same.

A value holding a `Bytes`, a non-finite number or a negative zero anywhere is
now stored in a tagged form (http.md §6.7.2): `~` followed by its JSON, with
each `Bytes` written `{"$bytes": "<base64>"}`, each non-finite number or
negative zero `{"$float": "Infinity"}` (or `"-Infinity"`, `"NaN"`, `"-0"`), and
each key of an object in the value that starts with `$` given one more `$` in
front, so a `Map(Text, V)` key or a `Set(Text)` member can never be taken for a
tag. After:

```
localStorage "blob": ~{"data":{"$bytes":"aGk="},"ratio":{"$float":"Infinity"}}
shown: same=true data=104,105 ratio=Infinity
```

The reader is strict. In the tagged form an object with a key starting with a
single `$` must be exactly `{"$bytes": <padded standard base64>}` or
`{"$float": "NaN" | "Infinity" | "-Infinity" | "-0"}`; anything else, like a
stored text that is not JSON, makes the read `.err` with a `Text` starting
`decode failed:` that names the key and the storage. A `getItem` that throws
(`SecurityError: …`) is still passed through as it is.

Every value JSON can hold is stored as its JSON text exactly as before, and no
JSON text starts with `~`, so keys already in storage read back unchanged, a
`Map` key `"$bytes"` included. An older runtime reading a tagged text answers
the read's `.err` (the text is not JSON) rather than a wrongly typed value. A
key an older build already wrote broken, such as
`{"data":{"0":104,"1":105},"ratio":null}` above, still reads back `.ok` with the
broken value, because `Decoder.Json(Blob)` checks only predicates.

`indexed.*` needs no tagged form: IndexedDB keeps a structured clone of the
record `indexed-write` puts, so a `Bytes`, a non-finite number or a negative
zero inside the written record comes back as itself (§6.7.4).
