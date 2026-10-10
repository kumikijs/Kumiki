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
call and `rename` writes `ThingId.fresh()` and exits 0. The walker and the
checker read the qualifier by one rule, so the walker sees exactly the
qualifiers the checker resolves. A built-in call of a namespace, such as
`Duration.ms(5)` or `EffectId.none`, names no type, even when the program
declares one of that name.
