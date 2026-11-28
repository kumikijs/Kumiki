---
"@kumikijs/compiler": minor
---

`Decoder.Json(T)` hands on only what `T` declares: it removes from each record every key its type does not declare, and from each variant every key but its tag and payloads, so `show` and `==` see a value of `T` and a record never reads as a variant.

A server answering `{"_tag": "a", "n": 1, "note": "x"}` for `Decoder.Json({n: Int})` used to reach `.ok` with both keys kept. The runtime tells a variant from a record by its `_tag` field, so `$v.show` rendered the record as the variant `a`, and `$v == {n=1}` was `false`:

```
before: $v.show  →  "a"         $v == {n=1}  →  false
after:  $v.show  →  "{n: 1}"    $v == {n=1}  →  true
```

A variant keeps its `_tag` and its payloads `_0`, `_1`, …, so `{"_tag": "None", "_0": 1}` read as an `Option(Int)` is `None`. A `File` keeps `_file`, the runtime's handle on the picked file. A `Map` keeps every key and a `Set` every member. A structured `Map` key or `Set` member that holds a key its type does not declare is refused, since no value is stored with one. Positions past the 32 levels the check walks into a growing generic are left as they came.

The same check runs on `storage.read`, `session.read` and `indexed.read`, so a stored value written by an older build loses the fields its type no longer declares. A host provider's `decode` removes the keys from the value it was given, so the provider must deliver that same value, and `decode` throws on a frozen value that holds such a key.
