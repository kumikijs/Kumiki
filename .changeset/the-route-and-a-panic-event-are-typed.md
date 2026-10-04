---
"@kumikijs/compiler": patch
---

Type the `route` slot, `$route`, and a panic reducer's `$event` as the values the runtime builds

`routing.md` §3.2 declares `slot route : Route`, and `lifecycle.md` §7.2.3 hands an `app.error` reducer a `PanicInfo` as `$event` — `route.error(<pattern>)` the same plus the matched `pattern`. The checker gave none of them a type: `route` is not a slot the program declares, `$route` was in scope untyped, and `$event` was untyped on every trigger. So a misspelt field or a field of the wrong type passed `check` and misbehaved at run time:

```kumiki
reducer measure on=ui.click(Measure) do= depth := route.path   # depth : Int
tile Detail = column(text("id: " + route.parms.get-or("id", "?")))
reducer onPanic on=app.error do= lastMessage := $event.mesage
```

Each of those is now reported: `depth := route.path` is E0201 `Expected Int but got Text`, and `route.parms` and `$event.mesage` are E0108. `route` is the standard `Route` wherever it is read, and `$route` is one where a trigger binds it (route.enter / route.leave / route.error, and a link's prefetch target). `$event` is the standard `PanicInfo` in an `app.error` reducer, so `$event.pattern` and `$event.stack` there are E0108; in a `route.error` reducer it is the same record with `pattern: Text` added. Every other trigger's `$event` is untyped, as before.

The types are taken from the standard library's definitions rather than looked up by name, so a program's own `type Route` or `type PanicInfo` does not change them — the runtime builds these values from the standard library's types either way.

One form that passed before is now reported, because the type says what the value is: storing a `route.error` panic whole in an `Option(PanicInfo)` slot is E0201 — the record carries `pattern` as well, and a record type matches only its own field set. No diagnostic changed across the example and benchmark corpora.
