---
"@kumikijs/compiler": patch
---

Read a tile's name written as a child as that tile

`column(leaf)`, where `leaf` is a tile the program defines, renders that tile:
code generation resolves a bare name in a container's child position to the
tile before anything else, and E0128 already counted it as a tile. The checker
then looked the same name up as a value too, so whether the program compiled
depended on what else was called `leaf`:

```kumiki
tile leaf = text("tile")
tile App = column(leaf)
```

```
$ kumiki check app.kumiki
E0103 undef-ref at 2:19: Reference to undefined name "leaf"
```

With a `fn leaf` beside the tile it was E0127 (`"leaf" is a fn, and a fn is not
a value`), and with a `slot leaf` it passed, checked as a read of the slot while
the build rendered the tile.

The checker now reads the name as the tile there, by the rule the lowering
uses, and checks nothing else about it. All three programs are `ok` and render
the tile. Where a value belongs (`text(leaf)`, `Card(leaf)`, a named argument)
the name is still a value.
