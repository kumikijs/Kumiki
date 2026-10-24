---
"@kumikijs/compiler": patch
---

An effect's `$1` in `map-request` and a `latest-per-key` key has the type its `in=` declares

language.md says both expressions are applied to the effect's input and are
checked like any other expression. `$1` entered their scope by name only, with
no type, so every member read on it was undecidable. A misspelt field passed
`check` and built a request with the field missing:

```kumiki
type UserQuery = {id: Text}
effect loadUser cap=http.get in=UserQuery out=Result(Text, HttpError)
    map-request={url: "/api/users/" + $1.idd, decode: Decoder.Text}
# … tile and app as usual
```

`check` was ok, and `smoke` reported `no HTTP fixture for GET /api/users/`. The
same `$1.idd` on a tile's `$1` was already E0108.

Now `$1` there has the type of the effect's `in=`, as a tile's `$1` has its own
`in=`. The program above is E0108 at `$1.idd` (`Record type has no field or
method ".idd"`), and so is `policy=latest-per-key($1.idd)`. Every check that
reads an operand's type reads `$1`'s too: `($1 * 2)` on a record is E0201, and
so is `latest-per-key($1 - 1)` on `in=Text`. A union's members and an `in=`
naming no type stay undecided. An effect declared `in=Unit` (through any alias
or nominal over it) is emitted with no argument, so `$1` is not bound there and
each read of it is E0103, where it passed `check` and failed at dispatch.

Member reads follow the type as well, which changes what is sent:

- `$1.size`, `$1.get` and `$1.keys` on a record with fields of those names now
  read the field, where they gave the number of fields, the whole record and
  its list of field names. `query: {"size": $1.size.show}` on
  `in={id: Text, size: Int}` sent `size=2`, and a `latest-per-key($1.size)` key
  was `"2"` for every request.
- `.keys`, `.entries` and `.to-list` on `in=Map(Int, …)` or `in=Set(Int)` give
  Int keys: `body: Json($1.entries)` sends `[[1, "a"]]` where it sent
  `[["1", "a"]]`.
