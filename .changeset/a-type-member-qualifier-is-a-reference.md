---
"@kumikijs/compiler": patch
---

`refs` and `rename` read a type-member call's qualifier as the type it names

`ItemId.fresh()`, `ItemId.parse(t)` and `ItemId.show(v)` name the type
`ItemId`, and the checker resolves them that way: drop the type and the call is
E0117. The reference walker did not see that use. It recorded an unqualified
callee as a `fn` and nothing for a qualified one, so `refs type.ItemId` left
out the reducer that mints the ids, and `rename` rewrote every other use, then
was rolled back on the call it had missed:

```
$ kumiki rename a.kumiki type.ItemId ThingId
Error: rename rejected: Validation failed: E0117 Reference to undefined type "ItemId"
```

So no id type minted with `fresh()` could be renamed at all.

The qualifier is now an edge to the type, at the qualifier, so `refs` lists the
reducer and `rename` writes `ThingId.fresh()` and exits 0. The walker and the
checker read the qualifier by one rule, so the walker sees exactly the
qualifiers the checker resolves. On `Decoder`, `EffectId`, `Duration` and
`Bytes`, only `parse(t)` / `show(v)` is a type-member call: with `type Decoder`
declared, `Decoder.show(d)` is a reference to it, while `Duration.ms(5)` and
the `EffectId.none` sentinel name no type.

The argument of `Decoder.Json(T)` is read as the type it decodes by, too. In
todomvc, `refs type.TodoId` now lists `effect.loadTodos` at its `map-request`
line as well, and `rename` rewrites `Decoder.Json(Map(TodoId, Todo))` with the
rest, so the built decoder still checks that each key is a uuid.
