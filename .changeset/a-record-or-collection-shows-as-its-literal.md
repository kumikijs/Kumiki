---
"@kumikijs/runtime": patch
"@kumikijs/compiler": patch
---

A record, a List, a Tuple, a Map and a Set show as the literal that builds them

`show` was `String(v)`, so a record, a Map or a Set rendered `[object Object]`,
and a List rendered its members joined by bare commas:

```
slot p : {name: Text}   = {name: "ada"}
slot m : Map(Text, Int) = {"a": 1}
slot s : Set(Int)       = [1, 2]
slot l : List(Int)      = [1, 2]

"p: " + p               p: [object Object]
p.show                  [object Object]
fmt("{0}", p)           [object Object]
"m: " + m               m: [object Object]
"s: " + s               s: [object Object]
"l: " + l               l: 1,2
```

An error-boundary fallback that wrote `"recovered: " + $1` rendered
`recovered: [object Object]` for the same reason.

Now each one is the literal that builds it:

```
"p: " + p               p: {name: "ada"}
p.show                  {name: "ada"}
fmt("{0}", p)           {name: "ada"}
"m: " + m               m: {"a": 1}
"s: " + s               s: [1, 2]
"l: " + l               l: [1, 2]
(1, "a").show           (1, "a")
"recovered: " + $1      recovered: {message: "…", location: "…", episode-id: None, cause: None, category: "tile-render"}
```

Each member is shown by the same rule, and a `Text` member is quoted, so
`["a", "b"]` is `["a", "b"]` and not `a,b`. A `Text` on its own, a number, a
`Bool`, a variant (its tag), `Time` and `Duration` show as before, and a `Bytes`
inside a structure is its base64, as it is on its own.
`+` with a `Text`, `.show`, `T.show`, `fmt`, a `key` and a tile's text all go
through one `show`, so they agree.

A Map, a Set and a Tuple are stored as plain objects and arrays, so the type
checker records their shape where they are shown and codegen passes it to
`show`. That shape is how a Tuple is told from a List and how a Map's keys
are read back as their declared type.

A program that compared or displayed a List's text as `1,2` now sees
`[1, 2]`. A `for` row's implicit key leaves out every record, Map and Set in
its element, at any depth, so editing one in place keeps the row's element: a
`for` over records still keys each row by its position, and a row of a Map's
`.entries` or of Tuples by the members around the record.
