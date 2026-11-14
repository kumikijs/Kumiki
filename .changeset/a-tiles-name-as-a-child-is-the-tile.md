---
"@kumikijs/compiler": patch
---

Read a tile's name written as a child as that tile, in `check` and in `refs`, `rename` and `remove --cascade`

`column(leaf)`, where `leaf` is a tile the program defines, renders that tile:
the build lowers it as it lowers `column(Leaf)`, the tile called with nothing
passed. `check` looked the name up as a value too, so whether the program
compiled depended on what else was called `leaf`:

```kumiki
tile leaf = text("tile")
tile App = column(leaf)

app M
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []
```

```
$ kumiki check app.kumiki
error E0103 undef-ref at 2:19: Reference to undefined name "leaf"
```

With a `fn leaf` beside the tile it was E0127 (`"leaf" is a fn, and a fn is not
a value`), and with a `slot leaf` it passed, checked as a read of the slot while
the build rendered the tile. The checker now reads the name as the build does,
as the tile called with nothing passed. All three programs are `ok` and render
the tile, and a tile that declares `in=` is E0213 there, missing its input, as
`column(Leaf)` is for a `Leaf` that declares one. A `for` or `match` binding of
the same name does not change that, since a value there would render nothing.

The reference graph read every bare name as a slot first, so beside a
`slot leaf` the child was filed under the slot: `kumiki refs app.kumiki
tile.leaf` listed nothing, `kumiki remove slot.leaf --cascade` also removed
`tile.App` and `app.M`, and `kumiki rename tile.leaf twig` left `column(leaf)`
behind and was rolled back. It now asks the same rule as the checker:
`refs tile.leaf` lists `tile.App`, removing the slot with `--cascade` removes
only the slot, and renaming the tile rewrites `column(leaf)`. In
`column(leaf, text(leaf))` each name goes to its own definition. The CLI and the
MCP tools (`kumiki_refs`, `kumiki_rename`, `kumiki_remove`) give the same
answers.

Where a value belongs (`text(leaf)`, `Card(leaf)`, a named argument) the name is
still a value. `packages/examples/features/290-tile-name-as-child.kumiki` shows
each case.
