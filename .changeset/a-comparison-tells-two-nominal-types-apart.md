---
"@kumikijs/compiler": minor
---

Report a comparison across two `nominal` types, as an assignment already was

Two `nominal` declarations over one base are two types (language.md §1.3.5), and
putting one where the other is required has been E0201 since the assignability
work. Comparing them was not reported at all:

```
type PostId = nominal Text where uuid
type UserId = nominal Text where uuid
slot p : PostId = "a"
slot u : UserId = "b"
slot n : Int = 0

reducer cmp on=ui.click(B) do= n := if p == u then 1 else 2   # was ok
reducer ord on=ui.click(B) do= n := if p <  u then 1 else 2   # was ok
```

The two operators got there by different routes and neither passed through the
rule. `==` was left total on the grounds that it is defined on every type, and
ordering asks `orderingFamily`, which unaliases — so two nominals over `Int` are
both "number" and two over `Text` are both "text".

So the check that existed caught the rarer spelling. `p == u` is the same
mistake as `p := u`, reads more naturally, and is the shape a router or a lookup
is written in: `for t in todos if t.id == selectedProjectId`.

Both now report once, at the comparison expression, naming both types as
written — where the old ordering check already reported, and where
`requireNumeric` would have reported once per offending side:

```
E0201 type-mismatch at 7:38: Operator "==" cannot compare PostId with UserId
```

The rule is the assignment rule read symmetrically — a comparison has no
destination, so there is no side to call the actual one. A type carrying no
nominal name of its own still compares with any nominal over it, so `cents == 0`
and `postId == ""` compare exactly as they assign, and a `Deep` declared
`nominal Cents` compares with a `Cents` in either order. Refused only when both
sides carry a name and neither was declared as the other.

Nothing else about the operators moves. `==` stays total over every *shape*,
including across an `Option` and its `None`; ordering still answers its family
question first, and a pair failing both — `flag < mark` on two `nominal Bool`
declarations — reports once.

The identity is read at the top level only, which an assignment does not do:
`List(Cents) := List(Yen)` is E0201 because `relate` descends into the type
argument, while `lc == ly` on the same pair stays silent. That is the one-sided
reading the whole relation keeps — a missing diagnostic, not a wrong one — and
§1.9.4 now says so rather than leaving it to be discovered.

This makes `==` non-total, which language.md §1.9.4 claimed it was. The spec
moves with it: §1.9.4 excepts the nominal identity rather than the rule
excepting the operators, and errors.md E0201, which said the operators were
outside the rule, now says they are inside it.

A program relying on the old silence stops compiling, and it was already wrong:
the two values were never the same type. Convert through the base the two share,
written as a `fn` whose return type names the destination — the same repair an
assignment across the pair needs.
