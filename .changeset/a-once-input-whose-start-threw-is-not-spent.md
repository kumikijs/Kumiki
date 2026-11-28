---
"@kumikijs/runtime": patch
---

Under `policy=once`, an input whose request threw as its `effect-start` was recorded is no longer spent, so its next emit launches

`once` noted an input as seen before it launched the request. When a host's
episode logger threw as it recorded that request's `effect-start`, the request
never ran, but every later emit of the same input was discarded as a repeat,
so that input never ran while the app lived. The input is now given back
before the throw is reported, so the next emit of it launches, including one an
`app.error` reducer makes. An input whose request ran, is in flight, was
refused by the capability check or was cancelled is still spent, as before.
