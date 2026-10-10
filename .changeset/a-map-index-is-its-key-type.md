---
"@kumikijs/compiler": patch
---

The index of a `Map(K, V)` is checked against `K`, on both sides of `:=`.

A `List` index was checked against `Int` on either side of `:=`, and a `Map` index against nothing. With `TodoId` and `PostId` both declared `nominal Text`, `notes[post]` on a `Map(TodoId, Text)` passed `check`, and so did the write `notes[post] := v`, the write through an entry `todos[post].done := true` on a `Map(TodoId, Todo)`, and `mt[1]` on a `Map(Text, Int)`. The program then indexed the Map with a value of another id space: the read panicked at run time (`Key "p1" is not in the Map`) where that value was no key and answered another entity's entry where it was one, and the write stored an entry under it.

Now each of those is E0201 at the index, naming the key type:

> `Expected TodoId but got PostId`
>
> `Expected Text but got Int`

A key is accepted the way a value of `K` is: `notes[todo]` with `todo : TodoId`, a `Text`, the literal `"t1"`, a nominal declared over `TodoId`, an `Int` into a `Map(Float, V)`, and a key whose type the checker cannot decide (`$el.key`) all still check. A list literal as the index of a `Map(Set(T), V)` is built as the Set it is declared to be (stdlib.md §2.2.2): `m[[1, 2]] := v` writes the entry `m[[2, 1]]` reads, and the one a Set value of the same members names. Both literals were arrays before, keyed in their order, so the read panicked.
