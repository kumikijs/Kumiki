---
"@kumikijs/compiler": patch
---

A loop variable, slot or match binding named like a builtin tile and written alone in an arm or a tile body is that value, so it is E0128 there as it is in a container, where it rendered the builtin.

```
slot xs : List(Text) = ["a", "b"]
tile P = column(for spinner in xs when(c, spinner))
# before: checks clean, and every item renders a spinner
# after:  E0128 A value is not a tile: a `when` arm has to be a tile. Show the value with a tile — `text(…)`
```

The same holds in an `if`, `for` or `match` arm, as a tile body (`tile P = divider` beside `slot divider`) and as a tile-test's `expect`. Written with its call or a prop block, the name is still the builtin: `when(c, spinner())` and `for divider in xs divider {id: "d"}` render it. A builtin's name that nothing else has is its call in an arm, as before.
