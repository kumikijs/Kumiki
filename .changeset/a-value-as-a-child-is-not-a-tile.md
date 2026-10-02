---
"@kumikijs/compiler": minor
---

A value written as a child tile is now **E0128 `value-as-child`**, at the value (#522).

A builtin other than the value builtins (`text`, `heading`, `markdown`, `code`, `editable`, `label`, `link`, `image`, `icon`) renders a positional argument only when it is a tile — a `tile-expr` or the name of a tile the program defines (language.md §1.7.1). Codegen dropped any other value there, and `check`, `build` and `smoke` all passed:

```
tile Card in={label: Text} = text($1.label)
tile Home = column(text("a"), 42)              # rendered only "a"
tile Home = column(text("a"), n)               # n a slot: a null in the child list
tile Home = column(let x = 42 in Card(x))      # mounted an empty root
```

A `let` also hid a tile from the checker: `Card`'s argument under it was not compared with its `in=`, and a builtin under it was looked up as a `fn` (E0116) — so `column(let x = 42 in text(x.show))` reported E0116 rather than the real problem. Nothing inside the value is checked now; a diagnostic in there shows once the value is moved.

A value where a value belongs is unaffected: a value builtin's content (`text(let x = 1 in x.show)`), a user tile's input (`Card(let x = "a" in {label: x})`), a named argument. Show the value with a tile (`text(n.show)`), write it where it is used, or compute it in a `fn`.

The recorded Codex output for the v3 learning-cost task writes a tile's `Text` input as a child (`column(HeaderBar, $1)`), so it now fails `check`; the benchmark summary is re-scored.
