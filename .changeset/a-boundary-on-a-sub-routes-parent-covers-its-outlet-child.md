---
"@kumikijs/runtime": patch
"@kumikijs/compiler": patch
---

Cover the child in a `route-outlet` with the parent's `error-boundary`

`docs/spec/lifecycle.md` §7.3 says a render panic is caught by the nearest
enclosing `error-boundary`. A child a `sub-routes` entry injects into the
parent's `route-outlet` is under the parent in the rendered tree, and was not
covered by the parent's boundary:

```kumiki
tile Boom = column(text(xs.head.get.show))            # declares no boundary
tile Shell error-boundary=Fallback sub-routes={"/shell/a" -> Boom} = column(route-outlet())
```

Navigating to `/shell/a` rendered the built-in top-level display, not
`Fallback`. `pickRootTile` returned from the parent's factory — and so from the
`try` / `catch` its boundary lowers to — before it built the child, so the child
rendered outside it. A boundary on the shell, the obvious way to write "one
fallback for this whole section", silently covered the frame and nothing else.

The parent's factory now takes the outlet's contents as a callback and applies
it around its own tree from inside its boundary, so the child is built under the
parent's guard. What follows is pinned beside it: the nearest boundary wins (a
child that declares its own shows its own fallback inside the outlet, and the
shell stays up), and the fallback's `PanicInfo.location` names the tile that
panicked rather than the one that declared the boundary — every route entry now
carries the name of the tile it targets, and a panic raised while building it is
attributed to that tile when nothing nearer has. The same attribution reaches
the built-in display: `data-kumiki-panic` names the route tile that panicked
where it used to be empty.

§7.3 says which reading holds, in both language tracks, and the known exception
its implementation status carried is gone. Routing §3.6.3 names the case.
`packages/examples/features/92-outlet-error-boundary.kumiki` is the section
with one fallback and a child that keeps its own, and its scenario asserts both.

`route.error`'s `$event.location` moves with it: for a render panic it was
absent, and it is the route target's name now — the same attribution the
built-in display carries. `app.error` and the episode log are unchanged; both
set `location` themselves.

`RouteEntry.tile` takes an optional `OutletFill` (new export). The runtime
always passes one, so an entry written as `tile: () => …` — a host's, or one a
runtime bundle from before this change emitted — still type-checks on both
sides and still renders its child: a parent that declares no parameter has
its outlet filled after it returns, outside its boundary, which is the
behaviour that factory was written for. A parent whose matched child finds no
`route-outlet` in the rendered tree (one under `when` / `if` / `match` that is
absent at runtime — E0113 accepts it) now reports the discarded child on
`console.error`, where the smoke and scenario tiers listen.
