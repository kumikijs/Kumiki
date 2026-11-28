---
"@kumikijs/compiler": patch
---

`kumiki refs`, `rename` and `remove --cascade` follow a slot or `fn` read alone in an arm, a tile body or a tile-test's `expect`, where the checker reports it as E0128, instead of missing it.

```
slot total : Int = 2
slot c : Bool = true
tile P = column(text("a"), when(c, total))
# kumiki refs app.kumiki slot.total
# before: (no references to slot.total)
# after:  tile.P  app.kumiki:3
```

`rename` of the slot now rewrites `when(c, total)` too, so the check of the renamed program reports the same E0128 at the new name; it used to report E0105 for `total`, a tile no program has. `remove --cascade` of the slot removes `tile.P` with it, where it used to be refused with that E0105. A builtin tile's name that a slot or `fn` has is that value's reference when written alone (`when(c, divider)` beside `slot divider`), as the checker reads it. A program's tile of the name, a builtin's call or prop block (`divider()`), and a binding in scope are no reference to the slot, as before.
