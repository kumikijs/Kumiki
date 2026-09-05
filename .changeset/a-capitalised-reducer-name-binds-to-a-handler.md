---
"@kumikijs/compiler": minor
---

Bind a handler to a capitalised reducer name

`onClick=Bump` on a defined `reducer Bump` was rejected, by a message that was
false of the input it rejected:

```
E0201 type-mismatch: Event handler arg "onClick" must be a reducer name
```

`Bump` is exactly a reducer name. What was in the way is the shape the parser
gives a capitalised one: a tile call as a named argument of a builtin that
takes tiles, a variant tag in a props block, on a value-arg builtin such as
`link` and on a user tile — never a reference, which is all the handler branch
accepted. So a reducer whose own name was capitalised could not be bound to a
handler at all.

The handler position resolves in the reducer namespace, and capitalisation is
not something the author is saying there, so all three shapes are now read as
the name they carry. One resolver serves the three consumers that have to
agree — the checker, codegen and the reference walker — because deciding it
per consumer is what left the name accepted by one and invisible to the others:
before this, the reference walker recorded a *tile* edge for a handler
argument, so `refs` listed a tile no definition declares and `rename` on the
reducer left the wiring behind.

What E0201 reports here is now a value that is no name — a literal, a variant
tag carrying a payload (`onClick=Some(1)`), a tile call carrying arguments. A
bare name that names no reducer is E0102 whatever its capitalisation, which is
what a lowercase one already answered; a tile name written in a handler
(`onClick=Card`) moves from E0201 to E0102 accordingly.
