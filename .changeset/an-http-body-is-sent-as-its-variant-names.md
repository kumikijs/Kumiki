---
"@kumikijs/runtime": patch
---

Send each `HttpBody` variant as what it names

A request body that was not a JS string was `JSON.stringify`ed as-is under
`Content-Type: application/json`, and nothing read the variant. So `Form(m)`
posted `{"_tag":"Form","_0":{…}}` as JSON, `Json(v)` posted the wrapper instead
of `v`, `Text(t)` posted a JSON object, and `Empty` sent a body. `apps/03-blog`
logs in and saves posts with `body: Json($1)`, so both requests carried the
wrapper.

Now (http.md §6.1.3 / §6.1.5): `Form` is URL-encoded as
`application/x-www-form-urlencoded`, `Json` sends its payload as
`application/json`, `Text` sends the text, `Multipart` a `FormData` (fetch
writes the boundary), `Bytes` the bytes, and `Empty` no body. A plain record or
list is still JSON. A Content-Type the program sets wins over the default, and
is now matched case-insensitively, so `content-type` no longer ends up beside a
second `Content-Type`.
