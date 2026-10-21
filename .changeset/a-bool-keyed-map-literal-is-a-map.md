---
"@kumikijs/compiler": patch
---

A Map literal whose first key is `true`, `false` or `now` is a Map, not a record

```
slot labels : Map(Bool, Text) = {true: "on", false: "off"}
```

Before, this was E0201 "Expected Map(Bool, Text) but got {true: Text, false: Text}", in a slot's initial value and in a reducer write alike. The parser, which decides between a record and a Map by the first key, read any identifier or reserved word followed by `:`, `=`, `,` or `}` as a record field — `true` and `false` included, though each is a value on its own. `{now: "start"}` against a `Map(Time, Text)` was the same E0201. Only a parenthesised first key, `{(true): "on", false: "off"}`, reached the Map.

After, the literal is the `Map(Bool, Text)` it reads as, the same Map the parenthesised form writes. Each entry is checked against the Map's types, so a value of the wrong type is E0201 at that value, and a key of the wrong type (`{true: "a"}` against a `Map(Int, Text)`) is E0201 at that key. The reserved words that are a value on their own (`true`, `false`, `now`) are keys, and every other reserved word names a field, so `{type: ui.click, target: Go}` and `{for: "name"}` are records (language.md §1.9).

A Bool key written twice is E0008, as a repeated string or number key is: `{true: "a", true: "b"}` and `{(true): "a", true: "b"}` are both `Map key "true" is written more than once`. Before, the parenthesised form was accepted and ran as `{true: "b"}`.

A value keyword where a record field name goes is a parse error at that keyword: `` `true` is a value, not a record field name ``. That is a value keyword after a record's first field (`{a: 1, true: 2}`, `{a, now}`), and a first key followed by `,`, `=` or `}`, which no Map entry is (`{true}`, `{now}`, `{true = 1}`). Before, each of these was a record with a field named `true` or `now`.
