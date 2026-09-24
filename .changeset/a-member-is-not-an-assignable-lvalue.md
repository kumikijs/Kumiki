---
"@kumikijs/compiler": minor
---

A stdlib member written as an assignment target is now a check-time error instead of a write that replaces the slot (#370).

`name.length := 9` on a `Text` slot passed `check`, built, and left the slot holding `{"length": 9}` — not a `Text`, not a value any expression reading it can use, and reported by nothing until a render tripped over it. The lvalue was flattened into a plain field path, so every member name became a literal key.

The read side has always resolved `recv.member` by the receiver's type: a record's own field wins, otherwise the name is a member. The write side asked that question only for a record, and for every other receiver it recorded "shortcut" and said nothing. It now asks the same question, and then the one the write side needs on top of it — whether what the name resolves to can be written *through*.

`language.md` §1.6.3's step set is stated as closed: a field, an index, and `.get` on an `Option` / `Result`. A member is none of those, and is **E0602 `unassignable-member`**, naming the member and the receiver type. `.get` stays legal only where §1.6.3 defines it — on a `Map` or a `List` it is a member like any other, and was the same corruption, since the runtime's setter falls through an unwrap segment on a value carrying no `_tag`.

The name is still dispatched rather than reserved: a record that declares a field named `length` is written through it as before. A receiver whose type the checker cannot decide reports nothing, as on the read side. And a member name that is not a member of a known receiver at all is now **E0108** on the write side too — the read side's own answer, which the write side was missing.
