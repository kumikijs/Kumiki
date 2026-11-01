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

Each of those is now reported: `depth := route.path` is E0201 `Expected Int but got Text`, and `route.parms` and `$event.mesage` are E0108. `route` is the standard `Route` wherever it is read, the `slots` that `run-reducer` answers in a test included. `$route` is one in a `route.enter` / `route.leave` / `route.error` reducer, also when a link names that reducer as its prefetch target; a prefetch target on any other trigger reads `$route` untyped, as before, because on its own trigger it is empty. `$event` is the standard `PanicInfo` in an `app.error` reducer, so `$event.pattern` and `$event.stack` there are E0108. In a `route.error` reducer it is a `RouteErrorInfo`, a new standard type: the same fields with `pattern: Text` added. Every other trigger's `$event` is untyped, as before. A link's `prefetch-args` is checked as the `Map(Text, Text)` its target reads as `$route.params`.

The types are taken from the standard library's definitions rather than looked up by name.

Two forms that passed before are now reported, because the type says what the value is. Storing a `route.error` panic whole in an `Option(PanicInfo)` slot is E0201: it is a `RouteErrorInfo`, which carries `pattern` as well, and a record type matches only its own field set, so keep it in an `Option(RouteErrorInfo)`. A `prefetch-args` that is not a map of text to text, such as `{"id": 7}`, is E0201 too. No diagnostic changed across the example and benchmark corpora.
