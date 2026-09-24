---
"@kumikijs/compiler": minor
---

A stdlib member written as an assignment target is now a check-time error instead of a write that replaces the slot (#370).

`name.length := 9` on a `Text` slot passed `check`, built, and left the slot holding `{"length": 9}` — not a `Text`, not a value any expression reading it can use, and reported by nothing until a render tripped over it. The lvalue was flattened into a plain field path, so every member name became a literal key.

The read side has always resolved `recv.member` by the receiver's type: a record's own field wins, otherwise the name is a member. The write side asked that question only for a record, and for every other receiver it recorded "shortcut" and said nothing. Both sides now ask one classifier, so "what is this name on this receiver" has a single answer; the write side adds only the question it alone needs on top of it — whether what the name resolves to can be written *through*.

`language.md` §1.6.3's step set is stated as closed: a field, an index, and `.get` on an `Option` / `Result`. A member is none of those, and is **E0602 `unassignable-member`**, naming the member and the receiver type. `.get` stays legal only where §1.6.3 defines it — on a `Map` or a `List` it is a member like any other, and was the same corruption, since the runtime's setter falls through an unwrap segment on a value carrying no `_tag`.

The name is still dispatched rather than reserved: a record that declares a field named `length` is written through it as before, and conversely a record does not declare `.show`, so `rec.show := "x"` is E0602 like any other member. A receiver whose type the checker cannot decide — a union, an opaque type parameter — reports nothing, as on the read side.

E0602 asserts that the name **is** a member of this receiver, so it is raised only where that is true. A name a known receiver does not have is **E0108** on the write side too, which is the read side's own answer and what the write side was missing entirely: one the receiver simply lacks (`name.frist`), and one belonging to another receiver — `.abs` is a method of `Int` / `Float`, so on a `Text` it is undefined rather than unassignable.

Refs #370. The `List` index write the example notes as out of scope is #462.
