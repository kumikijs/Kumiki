---
"@kumikijs/compiler": patch
---

`Decoder` is a type: a request record declared `in={key: Text, decode: Decoder}`, as http.md declares one, now checks, and a `decode` that is not a `Decoder` is E0201 (E0202 in an emit's argument).

`Decoder` named no type, so the spec's own storage read failed `check`:

```
effect storage-read cap=storage.read in={key: Text, decode: Decoder} out=Result(Option(Text), Text)
E0117 undef-type: Reference to undefined type "Decoder"
```

and a `map-request` could put any value in `decode` — `decode: "TEXT"`, a
`Text` slot, `$1` on `in=Text` — with nothing reporting it, though no decoder
built it and the handler decodes the answer by it.

`Decoder` is now a standard-library type: the type of `Decoder.Json(T)`,
`Decoder.Text`, `Decoder.Bytes` and `Decoder.None`, and of nothing else. No
literal is one, its only member is `show`, and `Decoder.parse(t)` is E0802, as
for any type a text has no reading as. A field declared `decode: Decoder`
takes a decoder, `$1.decode` of such an input, or a `fn` declared
`-> Decoder`. Anything else there is E0201 (E0202 in an emit's argument):

```
map-request={key: "note", decode: "TEXT"}
E0201 Expected Decoder but got Text      # at "TEXT"
```

A `map-request`'s `decode` is checked where the request's field names are: in
the record literal, in what an `if` branch, a `match` arm or a `let` body
yields there, and under a map literal's `"decode"` key. A request a `fn`
returns, a slot holds or `$1` is has its fields decided at run time and is not
checked.

Upgrade note: `Decoder` is reserved, like `Duration`, so a program's own
`type Decoder` is E0231 and the name keeps the standard library's type. A
`map-request` whose `decode` is not a decoder, and a `Decoder.*` value put
where another type is declared, now fail `check`. The examples and the
benchmark corpus produce no new diagnostic.
