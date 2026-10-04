---
"@kumikijs/compiler": patch
---

A Map literal whose first key is `true`, `false` or `now` is a Map, not a record

```
slot labels : Map(Bool, Text) = {true: "on", false: "off"}
```

Before, this was E0201 "Expected Map(Bool, Text) but got {true: Text, false: Text}", in a slot's initial value and in a reducer write alike. The parser decides between a record and a Map by the first key, and read any identifier or reserved word followed by `:` as a record field. `true` and `false` are reserved words, but no record type can declare a field with either name, so the record reading could never check. `{now: "start"}` against a `Map(Time, Text)` was the same E0201. Only a parenthesised first key, `{(true): "on", false: "off"}`, reached the Map.

After, the literal is the `Map(Bool, Text)` it reads as, the same Map the parenthesised form writes, and a value of the wrong type in it is E0201 at that value. The reserved words that are a value on their own (`true`, `false`, `now`) are keys, and every other reserved word still names a field, so `{type: ui.click, target: Go}` and `{for: "name"}` stay records (language.md §1.9). Once the first key has made a literal a record, a later `true`, `false` or `now` is a parse error at that key: `` `true` is a value, not a record field name ``.
