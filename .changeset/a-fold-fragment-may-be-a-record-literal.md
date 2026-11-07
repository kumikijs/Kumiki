---
"@kumikijs/compiler": patch
---

A `fold` whose fragment is a record or map literal builds a module that loads and runs

`fold` lowered its fragment to an arrow whose body was the fragment's
JavaScript as written, so a record literal came out as `(a, b) => { "n": … }`,
which JavaScript reads as a block. The program checked `ok` and the module did
not parse:

```kumiki
slot xs : List(Int) = [1, 2, 3]
slot n  : Int       = 0
reducer go on=ui.click(Go)
    do= n := xs.fold({n: 0}, {n: $1.n + $2}).n
```

```
$ kumiki smoke app.kumiki
SyntaxError: Unexpected token ':'
```

A map literal (`xs.fold({"s": 0}, {"s": $2})`) failed the same way, and so did
an `Option`'s or a `Result`'s `flat-map` whose fragment is one. Every fragment
lowered to an arrow body — `fold`, `flat-map`, `Map.update` and
`Result.map-err` — now holds that body in parentheses, so the click above shows
`n: 6`. `map`, `filter`, `find` and `sort-by` lower their fragment to a block
that `return`s it and were not affected. An app picks this up when it is
rebuilt.
