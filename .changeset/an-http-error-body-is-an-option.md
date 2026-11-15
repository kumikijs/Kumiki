---
"@kumikijs/runtime": patch
---

An `HttpError`'s `body` is now the `Option(Text)` its type declares, so anything
that hands `.err` an `HttpError` itself (a host provider for `http.*`, a
scenario script, a test mock, an episode recorded before this release) must
write `body` as `{"_tag": "None"}` or `{"_tag": "Some", "_0": "…"}` instead of a
string.

`HttpError` is `{status: HttpStatus, message: Text, body: Option(Text)}`
(stdlib.md §2.1.3), but every `HttpError` the runtime built carried a plain
string: the response text for a non-2xx status or an undecodable 2xx, and `""`
for an abort, a timeout, a network failure or a request body that could not be
sent. A program reading it as the Option it is typed as got the wrong answer:
`$e.body.is-some` was `false` even when the server sent a body, `.get-or("x")`
on an abort gave `""` instead of `"x"`, and a `match $e.body` with a `Some` and
a `None` arm found no arm for it.

`body` is now `Some` of the response's body text whenever a response arrived and
its body was read, `Some("")` for an empty one, and `None` when no response
arrived (status 0: an abort, a cancellation, a timeout, a network failure, an
unsendable request body) or the response's body could not be read (http.md
§6.4.1). Two cases around an unreadable body change too:

- A 2xx whose body could not be read keeps its own status. It used to report
  status 0, which `retry=` takes for a connection error, so a request the
  server had already accepted was sent again.
- A cancel or timeout that lands while a non-2xx's body is being read is the
  `aborted` error. It used to deliver the response's status, and so fired
  `app.http.on5xx` / `on401` for a request that was cancelled.

An `HttpError` handed to `.err` from outside the HTTP handler reaches it as
written, and nothing warns about one that still writes `body: ""`: the
generated provider types leave the err value as `unknown`. Such a value gives
the old symptoms, `.is-some` false and no `match` arm.
