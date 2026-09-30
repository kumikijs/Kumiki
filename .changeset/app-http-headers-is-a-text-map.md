---
"@kumikijs/compiler": minor
---

`app.http`'s `headers` is now checked as a `Map(Text, Text)`, the type of a
request's own `headers`, like `base-url`, `timeout` and `credentials` already
were (#511).

```
http = { headers: 42 }              # was ok; now E0201 Expected Map(Text, Text) but got Int
http = { headers: "x" }             # was ok; now E0201
http = { headers: {"X-A": 1} }      # was ok; now E0201 Expected Text but got Int, at the value
```

The runtime spreads the value into every request's headers: a number spreads to
nothing and a string to headers named `0`, `1`, … — either way not one intended
header reached the request, and each of these compiled, built and smoked.
`headers: {"Authorization": fmt(…)}` and a `Map(Text, Text)` slot are
unaffected. http.md §6.3.1 (en + ja) states the type.

A program that used to compile and run no longer compiles if it writes the
header names bare: `headers: {Content-Type: "application/json"}` is a record,
not a map, and is now E0201 at the field. Quote the names —
`{"Content-Type": "application/json"}` — to make it a map.
