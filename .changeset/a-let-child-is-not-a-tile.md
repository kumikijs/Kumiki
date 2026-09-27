---
"@kumikijs/compiler": minor
---

A `let` written as a child tile is now **E0128 `let-in-tile`**, at the `let`.

```
tile Card in={label: Text} = text($1.label)
tile Home = column(let x = 42 in Card(x))   # was ok, and mounted an empty root
```

`let` is not a `tile-expr` — a tile body has no local bindings (language.md
§1.7.1, §1.13). As a positional argument of a container it parsed as a value,
and codegen renders a container's value argument as nothing, so the child
vanished whatever it bound: `column(heading("h"), let x = () in Card(x))` showed
only the heading. The tile call under the `let` was never checked either — a
wrong argument to `Card` passed, and a builtin there was looked up as a `fn`.

A `let` where a value belongs is unaffected: a text builtin's content
(`text(let x = 1 in x.show)`), a user tile's input
(`Card(let x = "a" in {label: x})`), a named argument. Write the value where it
is used, or compute it in a `fn`.
