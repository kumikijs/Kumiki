---
"@kumikijs/cli": minor
---

A definition keeps its history, its revertable ops and its hash across a `rename`

The op log, `view --history`, `patch revert` and `view --hash` all keyed a
definition by its literal name. After `kumiki rename h.kumiki slot.count total`:

```
$ kumiki view h.kumiki slot.total --history
(no history for slot.total)
$ kumiki patch revert h.kumiki op_…     # a replace of slot.count made before the rename
Error: Definition "slot.count" not found
```

The hash was a sha256 of the definition's source lines, so it included the
definition's own name, the names it referenced, whitespace and comments. A
rename changed the hash of the renamed definition and of every definition that
referenced it, and so did a reformat. A `depends-on` digest recorded before a
rename no longer matched `view --hash` after it.

`view --history slot.total` now lists the ops made while the definition was
`slot.count`, back to the op that added it, then the rename, then the ops made
since. `slot.count` still lists the ops made under it, and ops on an earlier,
removed `slot.total` stay listed under `slot.total`. Ops on an earlier
`slot.count` that was removed before this one was added are not this
definition's, so `slot.total` does not list them.

`patch revert` acts on each definition under the name it has now. Reverting the
pre-rename `replace` restores its earlier body on `slot.total` and exits `0`,
even if another definition has taken the name `slot.count` since. The earlier
body is found under whichever name the definition had when it was logged.
Reverting a restoring `add` removes a member renamed since under its new name
instead of refusing. A recursive type or fn gets its earlier body back with its
references to itself under its new name:

```
type Tree = { v: Int, kids: List(Tree) }
$ kumiki replace h.kumiki type.Tree '{ v: Text, kids: List(Tree) }'   # op_X
$ kumiki rename h.kumiki type.Tree G
$ kumiki patch revert h.kumiki op_X
before: Error: Definition "type.Tree" not found
after:  type G = { v: Int, kids: List(G) }
```

A remove ends a definition. A revert of an op made on a definition that a
later op removed is refused, and nothing is written; before, it acted on
whatever had the name, so it could overwrite or delete an unrelated
definition:

```
slot count : Int = 1
$ kumiki replace h.kumiki slot.count 'Int = 2'    # op_X
$ kumiki remove h.kumiki slot.count               # op_R
$ kumiki add h.kumiki slot count 'Int = 99'       # another definition
$ kumiki patch revert h.kumiki op_X
before: reverted op_X  (op_…)                     # the new slot count : Int = 99 is now 1
after:  Error: patch revert: op_X replaced slot.count, which is no longer in the
        file: op_R removed slot.count; nothing was written
```

This holds for a definition put back by reverting the remove too: the op log
does not record that the restoring `add` undoes that remove, so to it the
restored definition is another one.

`view --hash` now hashes the definition's tokens. Whitespace and comments are
not part of them. The definition's own name is left out, and each reference to
another definition counts as that definition's hash. A rename, or a change of
whitespace or comments, leaves every hash as it was:

```
before rename:      slot.count 22e063467235bb30   reducer.inc 14b6b228c54802fe
after rename:       slot.total 22e063467235bb30   reducer.inc 14b6b228c54802fe
after reformatting: slot.total 22e063467235bb30   reducer.inc 14b6b228c54802fe
```

Definitions that refer to each other in a cycle are hashed as one unit, so a
member's hash no longer depends on which member is reached first. With
`type A = { b: List(B) }` and `type B = { a: List(A) }`, `add type C '{ a: A, b: B }'`
recorded a digest for `type.B` that `view --hash type.B` did not print; now
the two agree.

A change to what a body says still changes the hash of the definition and of
everything that depends on it. Two definitions that differ only in their names,
such as `slot a : Int = 0` and `slot b : Int = 0`, now have the same hash. A
known limitation follows: a reference to one of them hashes like a reference to
the other, so `a := b` and `b := a` have the same hash.

Every hash value is different from the one the previous version printed, so a
`depends-on` digest logged by an earlier version does not match `view --hash`
any more.
