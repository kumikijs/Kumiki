---
"@kumikijs/compiler": patch
---

The index of a `Map(K, V)` is checked against `K`, in a read as in a write.

A `List` index was checked against `Int` in a read and in a write, and a `Map` index against nothing. With `TodoId` and `PostId` both declared `nominal Text`, `notes[post]` on a `Map(TodoId, Text)` passed `check`, and so did the write `notes[post] := v`, the write through an entry `todos[post].done := true` on a `Map(TodoId, Todo)`, and `mt[1]` on a `Map(Text, Int)`. The program then indexed the Map with a value of another id space: the read panicked at run time (`Key "p1" is not in the Map`) where that value was no key and answered another entity's entry where it was one. The write `notes[post] := v` stored an entry under it, and `todos[post].done := true` changed another entity's entry where the value was one of its keys.

Now each of those is E0201 at the index, naming the key type:

> `Expected TodoId but got PostId`
>
> `Expected Text but got Int`

A key is accepted the way a value of `K` is: `notes[todo]` with `todo : TodoId`, a `Text`, the literal `"t1"`, a nominal declared over `TodoId`, an `Int` into a `Map(Float, V)`, and a key whose type the checker cannot decide (`$el.key`) all still check. In a nested write such as `mm[post][todo] := 1`, the keys are reported in source order, as in the read.
