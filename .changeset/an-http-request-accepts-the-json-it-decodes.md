---
"@kumikijs/runtime": patch
---

Send `Accept: application/json` when a request decodes JSON

http.md §6.1.5 lists `Accept: application/json` among the headers an HTTP
effect gets when its decoder is Json, but the built-in handler never sent it: a
`Decoder.Json(T)` request, or one naming no decoder, went out with no `Accept`,
so a server that negotiates on it could answer with something else.

Now the handler builds a request's headers through one merge: its own defaults
(`Accept: application/json` for a Json decoder, and the Content-Type the body
is sent as), then `app.http.headers`, then the effect's own `headers`, each name
matched in any letter case. A program's `accept` or `ACCEPT` replaces the
default, and each header reaches `fetch` with exactly one value.
`Decoder.Text`, `Decoder.Bytes` and `Decoder.None` send no `Accept`.

The spec also listed `User-Agent: Kumiki` as a default, which the runtime never
sent. It is not one: a browser does not reliably let a script set it, and
§6.1.5 / §6.9 now say the runtime sets none.
