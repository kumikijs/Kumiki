---
"@kumikijs/compiler": patch
---

Fire `tile.mount` / `tile.unmount` for an `error-boundary` fallback. A fallback
whose whole body is another user tile (`tile Oops in=PanicInfo = Inner`) now
fires `tile.mount(Oops)` where it fired `tile.mount(Inner)`.

`docs/spec/lifecycle.md` §7.1.6 defines `tile.mount(X)` / `tile.unmount(X)` as
the moment X appears in / disappears from the DOM. A boundary's fallback appears
when the boundary catches a panic, and fired neither:

```kumiki
reducer sawFallback on=tile.mount(Oops) do= fallbackMounts := fallbackMounts + 1
tile Oops in=PanicInfo = text("oops fallback")
tile Boom error-boundary=Oops = column(text(panic("bang")))
```

```
$ pnpm kumiki run fbmount.kumiki fbmount.scenario.json
[FAIL] step 0 (fallback on screen)
    assert: state fallbackMounts: expected 1, got 0
```

The runtime diffs mount / unmount against the `_named(…, "X")` marker on the
rendered tree. A call site and a route target put it there; the fallback,
lowered inside the boundary's `catch`, did not, so a `tile.mount(Oops)` that
counts error-page views never ran while a sibling tile's mount fired in the same
render. All three positions now mark the tree through one rule, so the fallback
mounts when it is shown and unmounts when it leaves (the declaring tile renders
again without panicking, or leaves itself), whether the declaring tile renders
at a call site, as a route target, or as a `sub-routes` parent. A fallback that
re-renders with the panic still there fires nothing. One shape still fires
nothing for the fallback: a declaring tile that is itself the whole body of
another user tile (`tile Outer = Boom`), where the outer marker wins; #794
tracks it.

Unchanged: the declaring tile and every tile under it still fire no
`tile.mount` while the fallback stands in, and the server's HTML is the same — the marker is not
rendered. One case moves: a fallback whose whole body is another user tile
(`tile Oops in=PanicInfo = Inner`) fired `tile.mount(Inner)` and now fires
`tile.mount(Oops)` instead, because a node carries one marker and the outer
tile's wins, as it already did at every call site (`tile Outer = Inner`).

§7.1.6 now says, in both language tracks, when a fallback mounts and unmounts
and that both events count per tile name, and
`packages/examples/features/215-boundary-fallback-mount.kumiki` shows a
fallback mount, stay mounted across a re-render, and unmount on recovery.
