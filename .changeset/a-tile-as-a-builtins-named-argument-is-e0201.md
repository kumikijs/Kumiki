---
"@kumikijs/compiler": patch
---

A `when` or a `for` written as a builtin's named argument — `progress(max=when(…))`, `box(header=when(…))` — is now E0201 at the `when` / `for`, as on a user tile; it used to build with the argument dropped.

A named argument is a prop, and a prop takes a value. A `when` or a `for` has no value form, so it parsed as a tile there; `check` and `smoke` passed, and codegen left the prop out of the node:

```
slot busy : Bool = false
tile App = column(progress(value=1, max=when(busy, text("x"))))
# before: ok, and the node is { kind: "progress", value: 1, … } with no max
# after:  E0201 Named argument "max" on tile "progress" is a prop, and a prop's value cannot be a tile — nothing renders it. Write the tile as a positional child of a container — `column(when(c, …))` — or pass a value — `progress(max=…)`
```

The message gives two fixes: write the tile as a positional child of a container, or pass a value. A user tile's named argument was already E0201; its message now gives the same two fixes, instead of suggesting the tile be passed as a tile's input, which is a value too. Nothing inside the `when` / `for` is checked, so a diagnostic in it shows once it is moved. A value `if` / `match` there stays a value (`button(disabled=if busy then true else false)`), and an argument another check already reports is reported once: a value builtin's named content (`label(text=when(…))`) stays E0236, a `text=` that never renders (`text(text=when(…))`) stays E0129, an `error`'s `field=` stays E0230 unless the `{…}` block writes a `field` too, and an event handler written as a `when` gets only the handler's own "must be a reducer name".
