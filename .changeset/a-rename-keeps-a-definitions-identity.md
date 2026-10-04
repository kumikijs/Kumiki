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
`slot.count`, then the rename, then the ops made since. `slot.count` still lists
the ops made under it, and ops on an earlier, removed `slot.total` stay listed
under `slot.total`.

`patch revert` acts on each definition under the name it has now. Reverting the
pre-rename `replace` restores its earlier body on `slot.total` and exits `0`,
even if another definition has taken the name `slot.count` since. The earlier
body is found under whichever name the definition had when it was logged.
Reverting a restoring `add` removes a member renamed since under its new name
instead of refusing.

`view --hash` now hashes the definition's tokens. Whitespace and comments are
not part of them. The definition's own name is left out, and each reference to
another definition counts as that definition's hash. A rename, or a change of
whitespace or comments, leaves every hash as it was:

```
before rename:      slot.count 22e063467235bb30   reducer.inc 14b6b228c54802fe
after rename:       slot.total 22e063467235bb30   reducer.inc 14b6b228c54802fe
after reformatting: slot.total 22e063467235bb30   reducer.inc 14b6b228c54802fe
```

A change to what a body says still changes the hash of the definition and of
everything that depends on it. Two definitions that differ only in their names,
such as `slot a : Int = 0` and `slot b : Int = 0`, now have the same hash.

Every hash value is different from the one the previous version printed, so a
`depends-on` digest logged by an earlier version does not match `view --hash`
any more.
