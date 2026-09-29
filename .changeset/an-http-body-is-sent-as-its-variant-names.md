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
`application/json` (`Json` of `Unit` sends `null`), `Text` sends the text,
`Multipart` a `FormData`, `Bytes` the bytes, and `Empty` no body. Any other
body (a record, a list, a bare `Text`) is JSON, as the spec says; a bare `Text`
used to go out as the raw string with no Content-Type.

A `Multipart` `FileV` that holds no file (a file record restored from
persistence) fails the effect with `HttpError{status: 0}` instead of uploading
`"[object Object]"`. A `Content-Type` set on a `Multipart` body is dropped, so
fetch writes the one with the boundary.

Header names are compared case-insensitively when the defaults,
`app.http.headers` and the effect's own `headers` are merged, so a global
`Content-Type` and an effect's `content-type` no longer both reach the server.
