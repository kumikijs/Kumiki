---
"@kumikijs/compiler": patch
---

A builtin tile's name that a loop variable, match binding, slot or `fn` also has is that value when written alone in an arm, a tile body or a tile-test's `expect`, so it is E0128 there as in a container instead of rendering the builtin.

```
slot xs : List(Text) = ["a", "b"]
slot c : Bool = true
tile P = column(for spinner in xs when(c, spinner))
# before: checks clean, and every item renders a spinner
# after:  E0128 A value is not a tile: a `when` arm has to be a tile. Show the value with a tile — `text(…)`
```

The same holds in an `if`, `for` or `match` arm, as a tile body (`tile P = divider` beside `slot divider`) and as a tile-test's `expect`. Written with its call or a prop block, the name is still the builtin: `when(c, spinner())` and `for divider in xs divider {id: "d"}` render it. A builtin's name that nothing in scope has is its call in an arm, as before, and so is one whose binding's scope has ended or not yet begun: `match pick with | Some(spinner) -> Header | None -> spinner` renders a spinner for `None`.
