---
"@kumikijs/compiler": patch
---

Type `$1` in an effect's `map-request` and `latest-per-key` key from its `in=`

language.md §1.5.2 says both expressions are applied to the effect's input and
are checked like any other expression. `$1` entered their scope by name only,
with no type, so every member read on it was undecidable. A misspelt field
passed `check` and built a request with the field missing:

```kumiki
type UserQuery = {id: Text}
effect loadUser cap=http.get in=UserQuery out=Result(Text, HttpError)
    map-request={url: "/api/users/" + $1.idd, decode: Decoder.Text}
```

```
$ kumiki check mapreq.kumiki
ok
$ kumiki smoke mapreq.kumiki
  [interaction] no HTTP fixture for GET /api/users/ — …
```

The same `$1.idd` on a tile's `$1` was already E0108.

`$1` there now has the type the effect's `in=` declares, as a tile's `$1` has
its own `in=`. The program above is
`E0108 undef-member at 5:39: Record type has no field or method ".idd"`, and so
is `policy=latest-per-key($1.idd)`. Every check that reads an operand's type
reads `$1`'s too: `($1 * 2)` on a record is E0201, and so is
`latest-per-key($1 - 1)` on `in=Text`. A union's members and an `in=` naming no
type stay undecided, as on a tile. On `in=Unit` (through any alias) the effect
is emitted with no argument, and `$1` keeps no type.

Field reads follow the type as well. A record field named like a stdlib member
was lowered as that member: `query: {"size": $1.size.show}` on
`in={id: Text, size: Int}` sent `size=2` — the number of the record's fields,
`Map.size` — and now sends the field's value. A record `get` field is read
rather than unwrapped, and `keys` rather than listed.

The examples and benchmark corpus produce no new diagnostic, and their
generated code is unchanged. `packages/examples/features/213-effect-input-typed.kumiki`
reads both fields of its `in=` record in `map-request` and keys the effect on
one of them; its HTTP fixture answers only the request built from both.
