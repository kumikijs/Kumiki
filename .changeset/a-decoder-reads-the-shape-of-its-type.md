---
"@kumikijs/compiler": minor
---

`Decoder.Json(T)` checks that a decoded value is a `T` (its records, lists, options, maps, unions and nominal types, not only the predicates `T` carries) and reads a `Time` field from ISO 8601 text, so a body of the wrong shape is the effect's `.err` instead of an `.ok` typed as `T`.

A server answering `{"id": "7", "title": "not a user"}` for `Decoder.Json({id: Int, name: Text})` used to reach `.ok`, where `$u.name` was undefined and `$u.id + 1` rendered `"71"`. It is now `.err`, an `HttpError` with the response's status, the text in `body`, and a `message` naming the first position that does not fit:

```
before: .ok($u)   →  "ok name= id+1=71"
after:  .err($e)  →  $e.message == "decode failed: expected Int at .id"
```

A field that is absent is `decode failed: missing at .name`. The value is checked in the form the program holds it in, the form `Json(v)` sends and storage writes, so an `Option` is `{"_tag": "None"}` / `{"_tag": "Some", "_0": …}` and a JSON `null` is no `None`. Fields the type does not declare are kept. A decode failure is not retried, as before.

A `Time` position reads text by `Time.parse`'s grammar and is written back as the instant, so `plus`, `diff`, `to-ms` and the comparisons work on a time the server sent as `"2026-03-07T10:00:00Z"`. A JSON number is milliseconds. Anything else, digits in a string included (`"1772877600000"`), is `decode failed: expected Time at .<field>`. A `T` that is a `Time` itself is read from a number only.

The same check runs on `storage.read`, `session.read` and `indexed.read`. A host provider for a read capability now receives `decode` as a function for every `Decoder.Json(T)` whose argument names a type, not only for a `T` with predicates. It returns `undefined` or the first failure, as before (`kind` is now also `expected <T>` or `missing`), and writes each instant it reads from text into the value it was given.
