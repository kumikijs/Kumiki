---
"@kumikijs/compiler": minor
---

`app.http`'s `base-url`, `timeout` and `credentials` are now checked against their types (#386).

Only the names in those fields were checked, so a value of the wrong type ran and did the wrong thing: `base-url: 42` sent the request to `42/ping`, `timeout: "soon"` reached `setTimeout` as `NaN` and aborted every request before it could answer, and `credentials: "bogus"` is a `fetch` init a browser refuses. Each is now **E0201** at the field, so a program that used to compile with one of these values no longer does.

- `base-url` takes anything assignable to `Text` (a type built on `Text`, such as `Url`, included).
- `timeout` takes anything assignable to `Int`, read as milliseconds: an `Int`, a `Duration`, a user `nominal Int`. The spec table said *duration* while every example wrote a bare `Int`; both are milliseconds at run time, so both are accepted and `http.md` §6.3.1 now says so. A `Float` is refused.
- `credentials` takes anything assignable to `Text`, and each literal that reaches the field, including a literal branch of an `if`, must be `omit`, `same-origin` or `include`.

A value computed at run time (a slot, a call) of the right type stays clean: the fields are evaluated per request, and reading a slot is the point.

`headers` is not part of this change. The spec gives it no type, so `headers: 42` still compiles; that gap is tracked in #511.
