---
"@kumikijs/cli": minor
---

`patch revert` of a `remove --cascade` restores everything the cascade removed

The revert re-added only the definition that `remove` was given. Every
dependent the cascade took stayed deleted, and the command still exited `0`.
On a real program that usually includes the `app`:

```
removed slot.b  (op_…)
  cascaded tile.Page
  cascaded tile.Show
reverted op_…  (op_…)
$ kumiki list c.kumiki
slot     a  (1-1)
slot     b  (6-6)
```

The revert now restores every definition in the op's `removed` list as one
`add` op. The requested definition is the op's own `layer` / `name` / `body`,
and the dependents go in a new `with` field. The restore is validated as a
whole, so a dependent is never added before the definition it refers to. Each
body is the last one the op log recorded before the remove. If any body is
missing, nothing is written and the command exits `1`, naming what it could
not restore:

```
Error: patch revert: cannot reconstruct the body of slot.b, tile.Show removed by op_…; nothing was written
```

Reverting that restore removes the same set again, and `patch apply` replays
an `add` with `with` as the same single op.
