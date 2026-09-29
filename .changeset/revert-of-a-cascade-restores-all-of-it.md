---
"@kumikijs/cli": minor
---

`patch revert` of a `remove --cascade` restores everything the cascade removed

The revert re-added only the definition that `remove` was given. Every
dependent the cascade took stayed deleted, and the command still exited `0`.
The lost set can include the `app`. In this example it is two tiles:

```
removed slot.b  (op_…)
  cascaded tile.Page
  cascaded tile.Show
reverted op_…  (op_…)
$ kumiki list c.kumiki
slot     a  (1-1)
slot     b  (6-6)
```

Every `remove` now records the body of each definition it deletes, as it stood
at that moment, in a new `bodies` field. The revert restores all of them as one
`add` op. The requested definition is the op's own `layer` / `name` / `body`,
and the dependents go in a new `with` field. The definitions are written in one
batch and validated together, since a dependent does not typecheck without the
definition it refers to. Because the bodies come from the remove itself, a
dependent restores correctly even if the op log never recorded it, or a rename
rewrote it without logging a new body.

A `remove` logged before `bodies` existed falls back to the last body the op
log recorded for each name. If any body is missing, nothing is written and the
command exits `1`, naming what it could not restore:

```
Error: patch revert: cannot reconstruct the body of slot.b, tile.Show removed by op_…; nothing was written
```

A cascade logged without its `removed` list is refused, because what it
removed is unknown.

Reverting that restore removes exactly the set it added, including a member
that no longer depends on the named definition. It is refused before anything
is written if a member is gone from the file, is locked by another agent, or is
referenced from outside the set:

```
Error: remove rejected: tile.Other references tile.Show, outside the definitions being removed (slot.b, tile.Page, tile.Show); nothing was written
```

`patch apply` replays an `add` with `with` as the same single op, and a cascade
`remove` that carries `removed` as a removal of that recorded set. `with`,
`bodies` and `removed` are checked when a patch file or the op log is read: a
malformed one is rejected by field name instead of writing `slot undefined` or
failing with a `TypeError`. `view --history` of a definition now also lists the
cascades that removed it and the restores that brought it back.
