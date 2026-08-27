---
"@kumikijs/compiler": minor
---

fix(compiler): give a route target the chrome every other call site gets.

A user tile carries two things the runtime needs: the `_named(…)` marker it
diffs `tile.mount` / `tile.unmount` against (lifecycle.md §7.1.6), and the
`try` / `catch` its `error-boundary` lowers to (§7.3). Both are applied by
`tileCallJs`, the lowering for a *call site*. A route target is lowered
straight from the route table by `genTile` — the body and nothing else — so a
tile had both guarantees everywhere except at a route root.

For the boundary that inverted the guarantee. The same tile, the same
declaration, two positions:

```kumiki
tile Fallback in=PanicInfo = column(text("caught: " + $1.message))
tile Boom error-boundary=Fallback = column(text(xs.head.get.show))
tile Host = column(Boom())
```

`routes={"/" -> Host}` caught the panic and rendered the fallback.
`routes={"/" -> Boom}` — the position §7.3 names — let it escape, and the app
did not mount. `check` and `build` were green either way.

For the marker it was a silence: `on=tile.mount(Panel)` never fired if `Panel`
was named by a route, and fired if the same `Panel` was a child.

A route target is now lowered as what it is — a call site of that tile — at all
three route-table sites: a plain route, a `sub-routes` parent, and a
`sub-routes` child. The boundary belongs to the tile, which is what §7.3 says:
it scopes the boundary to renders *under that tile*, and says nothing about
where the tile was written.

**Observable** for a program that already declared either: a `tile.mount` /
`tile.unmount` reducer on a route target starts firing, and a route root's
`error-boundary` starts catching where the panic used to escape to the built-in
top-level display. The third one is the headline: a route root whose render
panics used to leave the app unmounted — `smoke` reported a failure and nothing
rendered — and now mounts with the fallback in place.

A tile that is showing its fallback fires no `tile.mount` for itself, because
the boundary wraps the marker from the outside and the tile did not render.
That was already true at a call site; it is now true at a route root too, which
is the point — the two positions agree.

`genTile`'s third caller — the `_tilesById` table a `tile-test` compares against
— is deliberately unchanged: naming that tree would change what the test
compares.
