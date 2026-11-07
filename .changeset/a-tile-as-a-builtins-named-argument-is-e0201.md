---
"@kumikijs/compiler": patch
---

A `when` or a `for` written as a builtin's named argument — `progress(max=when(…))`, `box(header=when(…))` — is E0201 at the `when` / `for`, as it already was on a user tile, with two fixes: write the tile as a positional child of a container, or pass a value.

A named argument is a prop, and a prop takes a value. A `when` or a `for` has no value form, so it parsed as a tile there; `check` and `smoke` passed, and codegen lowered it to `undefined`:

```
slot busy : Bool = false
tile App = column(progress(value=1, max=when(busy, text("x"))))
# before: ok, and the node is { kind: "progress", value: 1, max: undefined, … }
# after:  E0201 Named argument "max" on tile "progress" is a prop, and a prop's value cannot be a tile — nothing renders it. Write the tile as a positional child of a container — `column(when(c, …))` — or pass a value — `progress(max=…)`
```

A user tile's named argument was already E0201; its message now gives the same two fixes, where it suggested passing the tile as a tile's input, which is a value too. Nothing inside the `when` / `for` is checked, so a diagnostic in it shows once it is moved. A value `if` / `match` there stays a value (`button(disabled=if busy then true else false)`), a value builtin's named content (`label(text=when(…))`) stays E0236, and an event handler written as a `when` is reported once, as a handler that must be a reducer name.
