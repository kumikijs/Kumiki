---
"@kumikijs/compiler": minor
---

Give `T.fresh()` and `T.parse(t)` the types stdlib §2.4 gives them

`stdlib.md` §2.4 says `TypeName.fresh()` is a `T` and `TypeName.parse(text)` an
`Option(T)`. `inferType` implemented neither. Its `Call` case looked the callee
up in `CALL_RESULT`, answered the `Duration.` and `Bytes.` qualifiers, and
otherwise fell through to `sym.fns.get(callee)` — which holds no dotted name. So
`TodoId.fresh()` was undecidable, and an undecidable expression is accepted
wherever it lands:

```
type PostId = nominal Text where uuid
type UserId = nominal Text where uuid
slot p : PostId = "a"

reducer mk on=ui.click(B) do= p := UserId.fresh()              # was ok
slot found : Option(PostId) = UserId.parse("x")                # was ok
```

That left the nominal identity telling `PostId` and `UserId` apart everywhere
*except* at the call that mints one — and `.fresh()` is how an id is normally
created, so the unchecked position was the one that mattered most. `.parse` is
the same gap one level in.

Both are now reported:

```
E0201 type-mismatch at 6:36: Expected PostId but got UserId
E0201 type-mismatch at 7:31: Expected Option(PostId) but got Option(UserId)
```

The qualifier is **resolved** rather than matched. A primitive answers as a
`TypePrim`, a `type` definition that needs no arguments as a `TypeRef`, and
anything else — a name with no definition, or a constructor still wanting its
arguments like `List` or a `type Box(T)` — answers nothing at all. The arity
half is the load-bearing one: an unapplied `TypeRef` to `Box` unaliases into an
unsubstituted body and mismatches against real types, so it would report a type
nobody wrote. An unresolvable name costs nothing by comparison — the relation
short-circuits on a `TypeRef` it cannot unalias — and
[E0117](https://kumiki.dev/spec/errors#e0117-undef-type) is the single report
there either way.

`fresh` is narrower still, because its lowering discards the qualifier: every
`T.fresh()` is the same `_s.freshId()`, a uuid `Text`. So it answers only for a
type a `Text` inhabits, which is what §2.4.1 scopes `fresh` to. Read without
that test the inference asserted types the lowering never produces —
`slot s : Text = Int.fresh()` became E0201 on a program whose value really is a
`Text`, a record type was believed of a string, and a `nominal Int` id answered
its own base. All three answer nothing, exactly as before this change.

`Duration` and `Bytes` keep their own answers, ahead of this rule: their members
are constructors rather than these two. `parse` is the one spelling they share
with it, and both get it wrong the same way — `Duration.parse(t)` and
`Bytes.parse(t)` answer a bare `Duration` / `Bytes` where the spec gives them
`Option(…)`, so writing the call as documented is E0201 and writing it wrongly
is clean. That is #424, left as it was rather than widened into this fix and now
pinned in both directions in `spec-divergences.test.ts`, so a fix that moves only
one of them is caught. The qualified `show` is unchanged: it is `v.show` under
another spelling and always a `Text`.

The corpus was measured rather than assumed. Every `.kumiki` file under
`packages/` and `docs/` — 126 of them, the examples, the benchmarks, and the
`packages/mcp`, `packages/cli` and `packages/vite` fixtures — produces a
byte-identical diagnostic list before and after, and the ```kumiki blocks under
`docs/spec/` are covered by `packages/tests/spec-blocks.test.ts`. Nothing in the
corpus gains a report.

A program that put one type's fresh id into another type's slot stops compiling,
and it was already wrong: the two were never the same type. The repair is the
one every other nominal mismatch takes — mint at the type the position declares,
or convert through the base the two share, written as a `fn` whose return type
names the destination.
