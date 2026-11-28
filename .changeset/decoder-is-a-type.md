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
literal is one, it has no members, and `Decoder.parse(t)` is E0802, as for any
type a text has no reading as. A field declared `decode: Decoder` takes only a
value of type `Decoder` — a `Decoder.*` call, or a name, field or `fn` result
typed `Decoder`. Anything else there is E0201 (E0202 in an emit's argument):

```
map-request={key: "note", decode: "TEXT"}
E0201 Expected Decoder but got Text      # at "TEXT"
```

A `map-request`'s `decode` is checked where the request's field names are: in
the record or map literal, and in what an `if` branch, a `match` arm or a
`let` body yields there. A request a `fn` returns, a slot holds or `$1` is has
its fields decided at run time and is not checked. An effect with no
`map-request` hands its input to the handler as the request, so a `decode`
its `in=` record declares is held to `Decoder` too:

```
effect r cap=storage.read in={key: Text, decode: Text} out=Result(Option(Text), Text)
E0201 Expected Decoder but got Text: with no map-request, effect "r"'s input is the storage.read request
```

A field is held to its own capability's rule. An `indexed.read` by key reads a
stored record, which neither `Decoder.Text` nor `Decoder.Bytes` can read, so
either written there is E0201 (E0202 in an emit's argument), where it used to
fail every run with `decode failed:`.

A `Decoder` is an opaque handle, as an `EffectId` is. Rendering one —
`text(d)`, `fmt("{0}", d)`, `d.show`, `"x" + d` — is E0204, since what it
prints is how the runtime builds the decoder. `==` and `!=` on a type that is
or holds a `Decoder` are E0201, and so are `List.contains` and `List.unique`
on a `List` of one: `Decoder.Json(Int) == Decoder.Json(Text)` was `true`. A
`Map` key or `Set` element type that is or holds one is E0204, as is a Map
literal keyed by one, and a `latest-per-key` key E0233, since a key keeps
none of the check a `Decoder.Json(T)` is. A `Decoder.Json(T)` whose `T` is
or holds a handle, a `Decoder` or an `EffectId`, is E0204 too, at each handle
it writes: a JSON body holds data, and no body decodes into a handle only the
runtime makes.

Upgrade note: `Decoder` is reserved, like `Duration`, so a program's own
`type Decoder` is E0231 and the name keeps the standard library's type. A
`map-request` whose `decode` is not a decoder, and a `Decoder.*` value put
where another type is declared, now fail `check`, and so does a
`Decoder.Json(T)` whose `T` is or holds an `EffectId`, which used to pass. The
examples and the benchmark corpus produce no new diagnostic.
