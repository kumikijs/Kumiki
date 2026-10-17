---
"@kumikijs/compiler": patch
---

Read a tile's name in a value position as the value, not as an expansion (E0005)

A slot and a tile may share a name, and a value builtin's content reads the
slot: `text(leaf)` shows the slot `leaf` and inlines nothing. The cycle check
still counted that `leaf` as the tile, so the tile reading the slot of its own
name was refused as one that expands into itself:

```kumiki
slot leaf : Text = "hello"
tile leaf = column(text(leaf))
tile App = column(leaf)
```

Before:

```
$ kumiki check leaf.kumiki
E0005 tile-cycle at 2:25: Tile "leaf" expands into itself (leaf → leaf)
```

After:

```
$ kumiki check leaf.kumiki
ok
```

and the app renders "hello". The same holds for every value builtin's content
(`heading`, `markdown`, `code`, `label`, `link`, `editable`) and for a user
tile's input: `Card(leaf)` passes the slot as `$1`, and the call to `Card` is
the only tile there.

An identifier argument is an expansion edge now only where the callee takes a
positional argument as a tile — the positions E0128 reads, through the same
`positionalIsTile` rule — so `column(leaf)` with a tile `leaf` is followed as
before, and a loop through such positions is still E0005 whether its names are
capitalised (`tile A = column(B)` / `tile B = column(A)`) or not.

The other readers of those edges change with them. W0212 and W0213 walk the
same edges to learn which builtin kinds a tile renders, so a slot named after
a builtin read as content — `slot button : Text` shown with `text(button)` —
no longer counts as a rendered `button`: a `ui.click(Row)` subscription or an
`onClick` on a `Row` that renders only that text is now reported as dropped,
where it was passed silently.

`docs/spec/errors.md` E0005 (both language tracks) says a value position adds
no edge, and `packages/examples/features/251-tile-name-in-value-position.kumiki`
renders a tile that reads the slot of its own name.
