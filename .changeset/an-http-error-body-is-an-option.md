---
"@kumikijs/runtime": patch
---

Deliver an `HttpError`'s `body` as the `Option(Text)` its type declares

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
§6.4.1). One function in the HTTP handler builds every `HttpError` it
delivers.

A scenario script or test mock that writes an `HttpError` by hand reaches
`.err` as written, so one that wrote `"body": ""` should now write
`"body": {"_tag": "None"}` for a request that got no response, or
`"body": {"_tag": "Some", "_0": "…"}` for one that did.
