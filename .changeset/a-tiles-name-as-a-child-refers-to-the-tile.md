---
"@kumikijs/compiler": patch
---

Resolve a tile's name written as a child to the tile in `refs`, `rename` and `remove --cascade`

A slot and a tile may share a name. Written where a tile belongs, as in
`column(leaf)`, the name is the tile: the build renders it and the checker reads
it that way. The reference graph read every bare name as a slot first, so the
use was filed under the slot:

```kumiki
slot leaf : Text = "hello"
tile leaf = column(text("tile"))
tile App = column(leaf)
```

```
$ kumiki refs app.kumiki tile.leaf
(no references to tile.leaf)
$ kumiki refs app.kumiki slot.leaf
tile.App  app.kumiki:3
```

So `kumiki remove slot.leaf --cascade` also removed `tile.App` and `app.M`, and
`kumiki rename tile.leaf twig` left `column(leaf)` behind and was rolled back.

The reference graph now asks the same rule as the checker. `refs tile.leaf`
lists `tile.App` at line 3 and `refs slot.leaf` lists nothing. Removing the slot
with `--cascade` removes only the slot, and renaming the tile rewrites
`column(leaf)`. In `column(leaf, text(leaf))` each name goes to its own
definition: renaming the slot rewrites `text(leaf)` only, and renaming the tile
rewrites `column(leaf)` only. The CLI and the MCP tools (`kumiki_refs`,
`kumiki_rename`, `kumiki_remove`) read the same graph and give the same answers.
A name where a value belongs (`text(leaf)`, `Card(leaf)`, a named argument) still
refers to the slot.
