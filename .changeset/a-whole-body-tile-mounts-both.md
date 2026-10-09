---
"@kumikijs/compiler": patch
"@kumikijs/runtime": patch
---

Fire `tile.mount` / `tile.unmount` for both tiles when one's whole body is the other

`docs/spec/lifecycle.md` §7.1.6 defines `tile.mount(X)` as X appearing in the
DOM. A tile whose whole body is another user tile puts both on screen, but only
the outer one mounted:

```kumiki
reducer sawInner on=tile.mount(Inner) do= innerM := innerM + 1
reducer sawOuter on=tile.mount(Outer) do= outerM := outerM + 1

tile Inner = text("inner")
tile Outer = Inner
tile App = column(Outer)
```

```
$ pnpm kumiki run whole.kumiki whole.scenario.json
[FAIL] step 0 (both tiles on screen)
    assert: state innerM: expected 1, got 0
```

The runtime diffs mount / unmount against the `_named(…)` marker on the
rendered tree, and a node carried one name: both call sites marked the same
node and the outer one overwrote the inner. `tile.unmount(Inner)` never fired
either, and a `tile Outer = column(Inner)` mounted both, so whether a reducer
ran depended on whether a container sat between the two tiles.

A node now carries the name of every user tile whose whole tree it is,
outermost first, and the runtime reads each one. `tile.mount(Outer)` and
`tile.mount(Inner)` both fire, `Outer`'s first, and leaving fires both
`tile.unmount`s in the same order. That holds at any depth (`tile A = B`,
`tile B = C`), through keyed `for` rows, a `when` or `match` branch, a route or
`sub-routes` target, and an `error-boundary` fallback: `tile Oops in=PanicInfo
= Inner` fires `tile.mount(Oops)` and `tile.mount(Inner)`, where it fired only
`Oops`. A tile on screen in several places is still one tile on screen, so an
`Inner` also shown on its own stays mounted while either remains.

Unchanged: the server's HTML (the marker is not rendered), a re-render keeps
the element and fires nothing, and a reconcile diagnostic's `tile` still names
the outermost tile. §7.1.6 says so in both language tracks, and
`packages/examples/features/255-whole-body-tile-mount.kumiki` shows both tiles
mount, stay mounted across a re-render, and unmount.
