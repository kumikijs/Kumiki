---
"@kumikijs/compiler": patch
---

`app.http`'s `headers` is now checked as a `Map(Text, Text)`, the type of a
request's own `headers`, like `base-url`, `timeout` and `credentials` already
were.

```
http = { headers: 42 }              # was ok; now E0201 Expected Map(Text, Text) but got Int
http = { headers: "x" }             # was ok; now E0201
http = { headers: {"X-A": 1} }      # was ok; now E0201 Expected Text but got Int, at the value
```

The runtime spreads the value into every request's headers, and a number or a
string spreads to nothing, so each of these compiled, built and smoked while
every global header silently disappeared. `headers: {"Authorization": fmt(…)}`
and a `Map(Text, Text)` slot are unaffected. http.md §6.3.1 (en + ja) states the
type.
