---
"@kumikijs/compiler": patch
---

`app.http`'s `base-url`, `timeout` and `credentials` are now checked against their types (#386).

Only the names in those fields were checked, so a value of the wrong type ran and did the wrong thing: `base-url: 42` sent the request to `42/ping`, `timeout: "soon"` reached `setTimeout` as `NaN` and aborted every request before it could answer, and `credentials: "bogus"` is a `fetch` init a browser refuses. Each is now **E0201** at the field.

- `base-url` takes a `Text` (a slot of a type built on `Text`, such as `Url`, included).
- `timeout` takes a `Duration` or an `Int`, read as milliseconds. The spec table said *duration* while every example wrote a bare `Int`; both are milliseconds at run time, so both are accepted and `http.md` §6.3.1 now says so.
- `credentials` takes a `Text`, and a literal must be `omit`, `same-origin` or `include`.

A slot of the right type stays clean: the fields are evaluated per request, and reading a slot is the point.
