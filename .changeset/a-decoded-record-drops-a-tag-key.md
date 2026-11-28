---
"@kumikijs/compiler": patch
---

`Decoder.Json(T)` removes a `_tag` key from each record it reads, so a response or a stored value that carries one is read as the record, not as a variant.

The runtime tells a variant from a record by its `_tag` field. A server answering `{"_tag": "a", "n": 1}` for `Decoder.Json({n: Int})` used to reach `.ok` with the key kept, so `$v.show` rendered the record as the variant `a`:

```
before: $v.show  →  "a"
after:  $v.show  →  "{n: 1}"
```

Only `_tag` is removed: any other key the type does not declare is kept, as before. The same check runs on `storage.read`, `session.read` and `indexed.read`. A `Map` key or a `Set` member that is a record holding a `_tag` key is refused, since no record is stored with one. A host provider's `decode` removes the key from the value it was given, so it throws on a frozen value whose record holds one.
