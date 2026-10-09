---
"@kumikijs/compiler": patch
---

Render a lower-cased tile written bare as a container's child as a call of it

`column(Leaf)` parses as a call of the tile `Leaf`. `column(leaf)` parses as a
name, since a slot may share it, and when it named a tile the lowering pasted
the tile's body in place: no `tile.mount` marker, no `error-boundary`, and the
body read in the scope of the place it was written. With a slot sharing the
tile's name, both of these passed `check`:

```kumiki
slot leaf : Text = "hello"
slot seen : Int = 0
reducer sawLeaf on=tile.mount(leaf) do= seen := seen + 1
tile leaf = column(text("tile body"))
tile App = column(leaf, text("seen: " + seen.show))
```

```kumiki
slot leaf : Text = "hello"
tile Oops in=PanicInfo = text("caught: " + $1.message)
tile leaf error-boundary=Oops = column(text(panic("bang")))
tile App = column(leaf)
```

```
$ pnpm kumiki run mount.kumiki mount.scenario.json
[FAIL] step 0 (mounted)
    assert: DOM should include "seen: 1"
$ pnpm kumiki run boundary.kumiki boundary.scenario.json
[FAIL] step 0 (mount)
    error: [kumiki] panic in render: bang
```

Now the first shows "seen: 1" and fires `tile.unmount(leaf)` when the tile
leaves, and the second shows "caught: bang", at mount and in
`renderToString`'s HTML alike. The bare name is lowered as the call of the
tile with nothing passed — the same lowering as `column(Leaf)`, which emits
the same JS as before. So the body also reads its own scope: in
`column(for name in names column(leaf))`, a `name` that `leaf`'s body reads is
the slot `name`, as `check` read it, not the loop's binding.

Of the repository's examples, only `68-name-uniqueness` writes a tile this way
(`entry` in `App`); its tree now carries the `entry` marker, and renders as
before. `docs/spec/lifecycle.md` §7.1.6 and §7.3 say that the case of the
name makes no difference, in both language tracks, and
`packages/examples/features/256-lowercase-tile-child.kumiki` shows a
lower-cased tile mounting, unmounting and falling back to its boundary.
