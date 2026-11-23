---
"@kumikijs/runtime": patch
---

`renderToString` no longer reports an effect error as having "no .err reducer" when its `.err` reducer, or the `app.http` reducer for its status, panics: the panic is reported, as a mount reports it.

The server pass counted a reducer as having taken the error only when its body applied, while a mount counts every reducer wired for the error. So on the server, an `.err` reducer that panicked had its panic recorded in the bootstrap episode and the error printed as well:

```
before: [kumiki] effect "loadNote" returned an error with no .err reducer: HTTP 404
after:  (nothing besides the reducer's panic)
```

A reducer whose batch a refinement refuses was already counted on both passes, and still is.
