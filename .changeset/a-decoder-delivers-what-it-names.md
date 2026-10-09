---
"@kumikijs/runtime": patch
---

Deliver what each `Decoder` names, over HTTP and storage alike

An effect that asked for `Decoder.Bytes` received the body's text. The HTTP
handler branched on `json` and `none` only, so the `"bytes"` sentinel fell
through to `res.text()`, and an effect declaring `out=Result(Bytes, HttpError)`
resolved with a JavaScript string. For a body of `日本語`:

| | before | after |
|---|---|---|
| value | `"日本語"` (a string) | a `Uint8Array` of 9 bytes |
| `$body.show` | `日本語` | `230,151,165,230,156,172,232,170,158` |

The bytes are the body as received (`res.arrayBuffer()`), so a body that is not
UTF-8 text arrives intact instead of with every invalid byte replaced by U+FFFD.
A non-2xx response's `HttpError.body` is still the response's text.

`storage.read` / `session.read` ignored the decoder altogether and parsed every
stored value as JSON. A value another writer stored as plain text failed under
`Decoder.Text`:

```
map-request={key: "theme", decode: Decoder.Text}    # localStorage: theme = dark
before: err  "SyntaxError: Unexpected token 'd', "dark" is not valid JSON"
after:  ok   Some("dark")
```

A stored value is now decoded as a response body is (http.md §6.7.2):
`Decoder.Text` delivers the stored text, `Decoder.Bytes` its UTF-8 bytes,
`Decoder.None` `Unit` (the read answers only whether the key is there), and
`Decoder.Json(T)` or no `decode` parses it as before. A stored text that does
not parse is `decode failed: SyntaxError: …`, the prefix a refused
`Decoder.Json(T)` already carried. `indexed.read` delivers records as stored,
as before.

Before upgrading: `storage.write` stores its value as JSON, so a `Text` it
wrote reads back under `Decoder.Text` as that JSON, quotes included. A program
that reads its own written `Text` with `Decoder.Text` got `dark` because the
decoder was ignored; it now gets `"dark"`. Read it with `Decoder.Json(Text)`.

A `decode` that is none of the four decoders is now an error naming it. A
`map-request` record is not checked against `Decoder`, so `decode: "TEXT"`
compiles; before, HTTP read it as text and storage as JSON. Now HTTP fails the
effect before any request (`HttpError{status: 0}`) and the storage and
IndexedDB reads are `.err`, each with a message naming the value (`decode is
"TEXT", which is not a Decoder`).
