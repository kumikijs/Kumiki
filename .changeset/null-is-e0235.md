---
"@kumikijs/compiler": patch
---

`null` where an expression goes is E0235, and `{null: 1}` is a Map

```
slot picked : Option(TodoId) = null
```

Before, `null` written where an expression goes was the parse error `Unexpected token in expression`, which says nothing about why — in a slot's initial value, an argument, `x == null`, a list item, a reducer write, a test's `given`. And `{null: 1}` was read as a record with a field named `null`, so against a `Map(Int, Int)` it was E0201 `Expected Map(Int, Int) but got {null: Int}`, and in a `let` it checked clean.

After, each of these is **E0235 `null-value`**, at the `null` and with nothing else reported about it: `` `null` is not a value — Kumiki has no null. Where a value may be absent, declare Option(T) and write None for no value, Some(x) for one ``. `null` is no longer a record field name: like `true`, `false` and `now` it is an expression on its own, so `{null: 1}` is a Map whose key is E0235, and `null` where a field name goes (`{null = 1}`, `{a, null}`, `{a: 1, null: 2}`) is the parse error `` `null` is not a record field name, and not a value — Kumiki has no null ``. Before, those three were records with a field named `null`.

language.md §1.2.2's list of reserved words now includes `test`, which the lexer already reserved.
