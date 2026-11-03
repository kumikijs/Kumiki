---
"@kumikijs/compiler": patch
---

Check the fields an effect's `map-request` writes against its capability's request

`map-request` is a record literal, and codegen copied every field of it into
the request handed to the capability's handler. The checker had no schema for
it, so a field the handler does not read was copied too and never looked at
again — a misspelling of one it does read included:

```kumiki
effect loadNote cap=http.get
                in=Unit
                out=Result(Text, HttpError)
                map-request={url: "/api/note", decode: Decoder.Text, headrs: {"X": "1"}}
```

Before, `check`, `build`, `smoke` and a scenario were all clean, the generated
request carried `"headrs": { ["X"]: "1" }`, and the header was never sent.
After, `check` reports **E0215** at `headrs`:

```
The http.get request has no field "headrs" — did you mean "headers"? (accepted: url, headers, query, decode)
```

The fields each capability's request has now live in one table,
`REQUEST_FIELDS` in `capabilities.ts`, published in http.md on both tracks:
`url` / `headers` / `query` /
`decode` on `http.get`, plus `body` on `http.post` / `put` / `patch` /
`delete`; `key` / `decode` on `storage.read` and `session.read`; `key` /
`value` on `storage.write` and `session.write`; `store` / `key` / `decode` /
`index` / `range` on `indexed.read`; `store` / `key` / `value` on
`indexed.write`; `store` / `key` on `indexed.delete`. The checker reads it, and
so does the codegen that hands a storage read its fields. The method is the
capability's and `timeout` / `credentials` are `app.http`'s, so none of them is
a request field.

A field is checked where a literal names it: the `map-request` record, the
record an `if` branch, a `match` arm or a `let` body yields there, and a map
literal's `Text` keys. A request returned by a `fn`, read from a slot or passed
as `$1` is not checked. A custom capability, and a standard one whose declared
effects reach only a host provider (`log.write`, `nav.*`, …), has no row and
is not checked.

Upgrade note: a program whose `map-request` writes a field outside its
capability's row now fails `check` — including `body` on `http.get`, which GET
never sent, and a field a host provider registered for a listed standard
capability read. Such a provider can move to a custom capability, whose request
is the provider's to define. The examples and benchmark corpus produce no new
diagnostic.
