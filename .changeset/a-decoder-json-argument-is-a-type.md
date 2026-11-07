---
"@kumikijs/compiler": patch
---

A misspelt type in `Decoder.Json(T)` is now **E0117 `undef-type`** at the name, where it used to pass `check` and build a decoder without that type's checks.

```
type TodoId = nominal Text where uuid
effect loadTodos cap=storage.read
                 in=Unit
                 out=Result(Option(Map(TodoId, Todo)), Text)
                 map-request={key: "todos", decode: Decoder.Json(Map(TodoIdd, Todo))}
# before: ok, and the built decoder dropped the uuid check on the keys
# after:  E0117 at `TodoIdd`: Reference to undefined type "TodoIdd"
```

The argument parses as a value, and codegen reads it back as a type, but the checker only ever checked it as a value, which reports nothing for a capitalised name. It now resolves the argument as a type, the reading the reference walker already used, wherever the call is written: a `map-request` field, a `fn` that builds the request, a `let`. A name nested inside it (`List(Usr)`, `Map(K, Vv)`, `Option(Usr)`, a record field, a misspelt constructor such as `Lst(Item)`) is reported at that name, and the argument is held to a declared type's other checks too, so `Decoder.Json(List(Item, Int))` is E0210. A correctly spelt type reports nothing new.
